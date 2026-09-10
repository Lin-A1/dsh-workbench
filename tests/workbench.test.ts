import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { WorkbenchGateway } from '../src/gateway.ts'
import { createTools, resolveConfig } from '../src/index.ts'
import { PROXY_ROUTE, extractRedirectTarget, rewriteHtml } from '../src/proxy.ts'
import { sanitizeTerminalText, stripAnsiSequences } from '../src/terminal/ansi.ts'
import type { WorkbenchServerFrame } from '../src/protocol.ts'
import { JournalStore } from '../src/terminal/journal.ts'
import { UnknownTerminalError, WorkbenchTerminalManager } from '../src/terminal/manager.ts'
import { ProfileStore } from '../src/terminal/profiles.ts'
import { createSentinelLineFilter, stripSentinel } from '../src/terminal/sentinel.ts'
import { TerminalStore } from '../src/terminal/store.ts'
import { FakeConnection } from './fakes.ts'

const tempDirs: string[] = []

afterAll(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dsh-workbench-test-'))
  tempDirs.push(d)
  return d
}

class FakeSocket {
  readonly sent: WorkbenchServerFrame[] = []
  readyState = 1
  OPEN = 1
  private readonly handlers = new Map<string, ((arg?: unknown) => void)[]>()

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as WorkbenchServerFrame)
  }

  on(event: string, listener: (arg?: unknown) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(listener)
    this.handlers.set(event, list)
  }

  close(): void {
    this.handlers.get('close')?.forEach(l => l())
  }

  message(raw: string): void {
    this.handlers.get('message')?.forEach(l => l(Buffer.from(raw)))
  }

  last(channel: string, type: string): WorkbenchServerFrame | undefined {
    return [...this.sent].reverse().find(f => (f as { channel: string; type: string }).channel === channel && (f as { channel: string; type: string }).type === type)
  }
}

const settle = (ms = 50): Promise<void> => new Promise(r => setTimeout(r, ms))

describe('workbench terminal manager & tools', () => {
  it('manages local and ssh terminals and validates schemas', async () => {
    const dir = await tempDir()
    const profiles = new ProfileStore(dir)
    const journal = new JournalStore(dir)
    const connections: FakeConnection[] = []

    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 4,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectSsh: async () => {
        const c = new FakeConnection()
        connections.push(c)
        return c
      },
      connectLocal: async () => {
        const c = new FakeConnection()
        connections.push(c)
        return c
      },
      onOpen: s => journal.attach(s),
    })

    const tools = new Map(createTools(manager, resolveConfig({}), profiles).map(t => [t.name, t]))
    const listTool = tools.get('workbench_terminal_list')
    const openTool = tools.get('workbench_terminal_open')
    const sendTool = tools.get('workbench_terminal_send')
    const readTool = tools.get('workbench_terminal_read')

    expect(listTool).toBeDefined()
    expect(openTool).toBeDefined()

    // 1. Open a local terminal
    const opened = await (openTool!.execute as Function)({ kind: 'local', name: 'dev', cwd: 'D:/test' }, { signal: new AbortController().signal })
    expect(opened.kind).toBe('local')
    expect(opened.terminalId).toContain('wb-term-')

    // 2. Subscribe and verify model-sent command broadcasting (two-way sync)
    const session = manager.get(opened.terminalId)
    const chunks: string[] = []
    session.subscribeOutput(text => chunks.push(text))

    const sent = await (sendTool!.execute as Function)({
      terminalId: opened.terminalId,
      data: 'echo test',
      submit: true,
    }, { signal: new AbortController().signal })
    expect(sent.exitCode).toBe(0)
    expect(sent.waitReason).toBe('command_done')
    // Real-PTY path: only the [AI]$ attribution marker broadcasts; the command
    // text is NOT duplicated (the shell echoes it itself).
    expect(chunks.join('')).toContain('[AI]$')
    expect(chunks.join('')).not.toContain('[AI] $ echo test')

    // 3. Verify schema conformance of list output
    const listSchema = listTool!.output.schema as { items?: { properties?: Record<string, unknown> } }
    const declared = new Set(Object.keys(listSchema.items?.properties ?? {}))
    const listResult = await (listTool!.execute as Function)({})
    expect(listResult.length).toBe(1)
    for (const item of listResult) {
      const extraKeys = Object.keys(item as Record<string, unknown>).filter(k => !declared.has(k))
      expect(extraKeys).toEqual([])
    }

    // 4. Read terminal
    const readResult = await (readTool!.execute as Function)({ terminalId: opened.terminalId })
    expect(readResult.text).toContain('command output')

    await manager.closeAll()
  })

  it('keeps every session\'s terminals to itself and re-claims orphans', async () => {
    const dir = await tempDir()
    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 4,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectLocal: async () => new FakeConnection(),
      terminalStore: new TerminalStore(dir),
    })

    const a = await manager.open({ kind: 'local', sessionId: 'session-a', cwd: '/tmp' })
    const b = await manager.open({ kind: 'local', sessionId: 'session-b', cwd: '/tmp' })
    const orphan = await manager.open({ kind: 'local', cwd: '/tmp' })

    // Strict per-session scoping: a session sees its own terminals and nothing
    // else, so two conversations never share a shell or a workspace.
    expect(manager.list('session-a').map(t => t.terminalId)).toEqual([a.snapshot.terminalId])
    expect(manager.list('session-b').map(t => t.terminalId)).toEqual([b.snapshot.terminalId])
    expect(manager.list().map(t => t.terminalId).sort()).toEqual(
      [a.snapshot.terminalId, b.snapshot.terminalId, orphan.snapshot.terminalId].sort(),
    )

    // An unattributed terminal is claimed by the first session that asks, so it
    // stays reachable instead of being hidden behind the filter forever.
    await manager.adopt([orphan.snapshot.terminalId], 'session-a')
    expect(manager.list('session-a').map(t => t.terminalId).sort()).toEqual(
      [a.snapshot.terminalId, orphan.snapshot.terminalId].sort(),
    )

    await manager.closeAll()
  })

  it('reports which ids are open when a stale id is used', async () => {
    const dir = await tempDir()
    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 4,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectLocal: async () => new FakeConnection(),
    })
    const live = await manager.open({ kind: 'local', sessionId: 'session-a', cwd: '/tmp' })

    try {
      manager.get('wb-term-1-9')
      expect.unreachable('a stale id must not resolve')
    }
    catch (err) {
      expect(err).toBeInstanceOf(UnknownTerminalError)
      const message = (err as Error).message
      expect(message).toContain('wb-term-1-9')
      // The recovery path names the ids that DO exist, so a caller can retry
      // against a live terminal instead of the dead handle it remembered.
      expect(message).toContain(live.snapshot.terminalId)
    }

    await manager.closeAll()
  })

  it('loses no spec when terminals are persisted concurrently', async () => {
    const dir = await tempDir()
    const store = new TerminalStore(dir)
    const spec = (id: string) => ({ id, kind: 'local' as const, sessionId: 'session-a', createdAt: Date.now() })

    // Three un-awaited saves in one tick: an unserialized read-modify-write
    // would let the last writer win and silently drop the other two, and a
    // dropped terminal never comes back after a restart.
    await Promise.all([store.save(spec('wb-term-1-1')), store.save(spec('wb-term-1-2')), store.save(spec('wb-term-1-3'))])
    expect((await store.list()).map(s => s.id).sort()).toEqual(['wb-term-1-1', 'wb-term-1-2', 'wb-term-1-3'])

    await Promise.all([store.remove('wb-term-1-1'), store.save({ ...spec('wb-term-1-4'), name: 'kept' })])
    expect((await store.list()).map(s => s.id).sort()).toEqual(['wb-term-1-2', 'wb-term-1-3', 'wb-term-1-4'])
  })
})

describe('workbench multi-channel gateway', () => {
  it('handles hello, open, attach, output, input, and profiles', async () => {
    const dir = await tempDir()
    const profiles = new ProfileStore(dir)
    const journal = new JournalStore(dir)
    const connections: FakeConnection[] = []

    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 4,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectLocal: async () => {
        const c = new FakeConnection()
        connections.push(c)
        return c
      },
      onOpen: s => journal.attach(s),
    })

    const gateway = new WorkbenchGateway({
      terminalManager: manager,
      profileStore: profiles,
      journalStore: journal,
    })

    const socket = new FakeSocket()
    gateway.handleConnection(socket as unknown as import('ws').WebSocket)
    await settle()

    const hello = socket.last('workbench', 'hello')
    expect(hello).toBeDefined()

    // Save profile
    socket.message(JSON.stringify({
      channel: 'terminal',
      type: 'profiles:save',
      profile: { name: 'local-test', kind: 'local' },
    }))
    await settle()
    expect(await profiles.list()).toHaveLength(1)

    // Open terminal via gateway
    socket.message(JSON.stringify({
      channel: 'terminal',
      type: 'open',
      request: { kind: 'local', name: 'test-sh' },
    }))
    await settle()

    const opened = socket.last('terminal', 'opened')
    expect(opened).toBeDefined()
    const termId = (opened as { view: { terminalId: string } }).view.terminalId

    // Attach terminal
    socket.message(JSON.stringify({
      channel: 'terminal',
      type: 'attach',
      id: termId,
    }))
    await settle()

    const attached = socket.last('terminal', 'attached')
    expect(attached).toBeDefined()

    // Send input from human
    socket.message(JSON.stringify({
      channel: 'terminal',
      type: 'input',
      id: termId,
      data: 'whoami\r',
    }))
    await settle()
    expect(connections[0].shell.writes.at(-1)).toBe('whoami\r')

    // Close terminal
    socket.message(JSON.stringify({
      channel: 'terminal',
      type: 'close',
      id: termId,
    }))
    await settle()
    const closed = socket.last('terminal', 'closed')
    expect(closed).toMatchObject({ channel: 'terminal', type: 'closed', id: termId })

    await manager.closeAll()
  })
})

describe('sentinel & filtering', () => {
  it('correctly filters markers and extracts exit codes', () => {
    const filter = createSentinelLineFilter()
    expect(filter('hello world\n')).toBe('hello world\n')
    expect(filter('printf \'__DSHWB_DONE_1_1_abc__:%s\\n\' "$?"\n')).toBe('')
    expect(filter('__DSHWB_DONE_1_1_abc__:0\nclean\n')).toBe('clean\n')

    expect(stripSentinel('out\n__DSHWB_DONE_s_1_a__:42\n', '__DSHWB_DONE_s_1_a__')).toEqual({
      text: 'out',
      exitCode: 42,
    })
  })

  it('protects terminal input during in-flight model command execution and allows Ctrl+C', async () => {
    const dir = await tempDir()
    const journal = new JournalStore(dir)
    const connections: FakeConnection[] = []

    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 2,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectLocal: async () => {
        const c = new FakeConnection()
        connections.push(c)
        return c
      },
      onOpen: s => journal.attach(s),
    })

    const { snapshot } = await manager.open({ kind: 'local', name: 'lock-test' })
    const session = manager.get(snapshot.terminalId)

    const busyEvents: { busy: boolean; actor?: string }[] = []
    session.onBusyChange((busy, actor) => {
      busyEvents.push({ busy, actor })
    })

    expect(session.isBusy()).toBe(false)
    expect(session.collaborationView().busy).toBe(false)

    // Start a send in background
    const sendPromise = session.send({
      data: 'long-running-cmd',
      submit: true,
      idleMs: 50,
      timeoutMs: 500,
    })

    // Immediate state check: should be busy
    expect(session.isBusy()).toBe(true)
    expect(session.collaborationView().busy).toBe(true)
    expect(session.collaborationView().busyActor).toBe('model')

    // During busy: ordinary human input should be protected/ignored
    const writesBefore = connections[0].shell.writes.length
    session.humanWrite('interfering text\n')
    expect(connections[0].shell.writes.length).toBe(writesBefore)

    // Ctrl+C (\x03) emergency interrupt should be permitted
    session.humanWrite('\x03')
    expect(connections[0].shell.writes.at(-1)).toBe('\x03')

    await sendPromise
    expect(session.isBusy()).toBe(false)
    expect(busyEvents).toEqual([
      { busy: true, actor: 'model' },
      { busy: false, actor: undefined },
    ])

    await manager.closeAll()
  })
})

describe('ansi sanitizing', () => {
  it('strips escape sequences and resolves TUI redraws to cooked text', () => {
    // CSI/OSC/charset escapes vanish
    expect(stripAnsiSequences('\x1b[2K\r\x1b[1;32mok\x1b[0m\x1b]0;title\x07\x1b(B')).toBe('\rok')

    // carriage-return overwrite: spinner frames collapse; a shorter final
    // frame leaves the residue a real TTY would still show on screen
    expect(sanitizeTerminalText('working\rworking.\rworking..\rdone')).toBe('doneing..')
    expect(sanitizeTerminalText('working\rworking.\rworking..\rcomplete!')).toBe('complete!')

    // overwrite keeps the tail when the new frame is shorter (real TTY semantics)
    expect(sanitizeTerminalText('100%\r50%')).toBe('50%%')

    // full-screen redraw storm cooks down to readable content
    const storm = Array.from({ length: 50 }, (_, i) => `\x1b[H\x1b[2Kframe ${i}\x1b[K\n`).join('')
    const cooked = sanitizeTerminalText(storm)
    expect(cooked).not.toContain('\x1b')
    expect(cooked).not.toContain('[K')

    // backspace erasure
    expect(sanitizeTerminalText('10\b\b\b100%')).toBe('100%')

    // blank-run collapse
    expect(sanitizeTerminalText('a\n\n\n\n\nb')).toBe('a\n\n\nb')
  })

  it('sanitizes send output so TUI noise never reaches the model', async () => {
    const dir = await tempDir()
    const journal = new JournalStore(dir)

    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 2,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectLocal: async () => {
        const c = new FakeConnection()
        // Simulate a TUI program: escape-heavy redraw before the sentinel
        c.shell.onWrite = (data) => {
          if (data.includes('tui-cmd')) {
            c.shell.emit('\x1b[H\x1b[2Kthinking…\x1b[K\r\n\x1b[32m✔ done\x1b[0m\r\n\r\n\r\n')
          }
        }
        return c
      },
      onOpen: s => journal.attach(s),
    })

    const { snapshot } = await manager.open({ kind: 'local', name: 'ansi-test' })
    const session = manager.get(snapshot.terminalId)
    const result = await session.send({ data: 'tui-cmd', submit: true, idleMs: 50, timeoutMs: 500 })
    expect(result.output).not.toContain('\x1b')
    expect(result.output).toContain('done')
    await manager.closeAll()
  })
})

describe('reader proxy rewriting', () => {
  it('strips scripts, routes links/forms through the proxy, and anchors subresources', () => {
    const page = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
<meta charset="utf-8"><title>bd</title>
<link rel="stylesheet" href="/static/s.css">
</head><body>
<script>alert('x')</script>
<script src="/a.js"></script>
<a href="/s?wd=deepseek">search</a>
<a href="javascript:void(0)">noop</a>
<a href="#top">anchor</a>
<form action="/search" method="get"><input name="wd"></form>
<iframe src="https://ads.example.com/frame"></iframe>
<img src="/img/logo.png">
</body></html>`

    const out = rewriteHtml(page, 'https://www.baidu.com/')
    // scripts and CSP gone
    expect(out).not.toContain('<script')
    expect(out).not.toContain('Content-Security-Policy')
    // navigable links proxied with absolute target
    expect(out).toContain(`href="${PROXY_ROUTE}?url=${encodeURIComponent('https://www.baidu.com/s?wd=deepseek')}"`)
    // javascript/anchor untouched
    expect(out).toContain('href="javascript:void(0)"')
    expect(out).toContain('href="#top"')
    // GET form action proxied (browser appends ?wd=... on submit)
    expect(out).toContain(`action="${PROXY_ROUTE}?url=${encodeURIComponent('https://www.baidu.com/search')}"`)
    // nested iframe proxied too
    expect(out).toContain(`src="${PROXY_ROUTE}?url=${encodeURIComponent('https://ads.example.com/frame')}"`)
    // <base> anchors relative subresources to the origin page
    expect(out).toContain('<base href="https://www.baidu.com/">')
    expect(out).toContain('href="/static/s.css"')
    expect(out).toContain('src="/img/logo.png"')
  })

  it('absolutizes relative hrefs before proxying', () => {
    const out = rewriteHtml('<a href="page.html">next</a>', 'https://example.com/docs/index.html')
    expect(out).toContain(encodeURIComponent('https://example.com/docs/page.html'))
  })

  it('detects client-side redirect shells (meta refresh, protocol rewrite, location literal)', () => {
    // Baidu-style bot shell: computed protocol rewrite
    const shell = `<html><head><script>location.replace(location.href.replace("https://","http://"));</script></head></html>`
    expect(extractRedirectTarget(shell, 'https://www.baidu.com/')).toBe('http://www.baidu.com/')

    // classic meta refresh
    const meta = `<meta http-equiv="refresh" content="0;url=https://example.com/landing">`
    expect(extractRedirectTarget(meta, 'https://old.example.com/x')).toBe('https://example.com/landing')

    // literal location assignment
    const literal = `<script>location.href='https://moved.example.net/home'</script>`
    expect(extractRedirectTarget(literal, 'https://example.com/')).toBe('https://moved.example.net/home')

    // normal pages bounce nowhere
    expect(extractRedirectTarget('<html><body>hello</body></html>', 'https://example.com/')).toBeUndefined()
  })
})

describe('workbench browser tools', () => {
  it('opens, lists, and closes shared browser tabs with summon broadcast', async () => {
    const dir = await tempDir()
    const profiles = new ProfileStore(dir)
    const journal = new JournalStore(dir)
    const manager = new WorkbenchTerminalManager({
      allowlist: [],
      maxSessions: 2,
      defaultPort: 22,
      connectTimeoutMs: 100,
      maxScrollbackBytes: 64 * 1024,
      connectLocal: async () => new FakeConnection(),
      onOpen: s => journal.attach(s),
    })
    const gateway = new WorkbenchGateway({ terminalManager: manager, profileStore: profiles, journalStore: journal })

    const tools = new Map(createTools(manager, resolveConfig({}), profiles, gateway).map(t => [t.name, t]))
    const openTool = tools.get('workbench_browser_open')!
    const listTool = tools.get('workbench_browser_list')!
    const closeTool = tools.get('workbench_browser_close')!

    const FakeSocket2 = class {
      readonly sent: WorkbenchServerFrame[] = []
      readyState = 1
      OPEN = 1
      send(raw: string): void { this.sent.push(JSON.parse(raw) as WorkbenchServerFrame) }
      on(): void { /* no-op */ }
      close(): void { /* no-op */ }
    }
    const sock = new FakeSocket2()
    gateway.handleConnection(sock as unknown as import('ws').WebSocket)

    const opened = await (openTool.execute as Function)({ url: 'https://www.baidu.com', title: '百度' }, { signal: new AbortController().signal })
    expect(opened.id).toContain('wb-page-')
    expect(opened.title).toBe('百度')

    const listed = await (listTool.execute as Function)({}, { signal: new AbortController().signal })
    expect(listed).toHaveLength(1)

    // open broadcasts an opened frame + summon to connected clients
    await new Promise(r => setTimeout(r, 15))
    expect(sock.sent.some(f => f.channel === 'browser' && f.type === 'opened')).toBe(true)
    expect(sock.sent.some(f => f.channel === 'workbench' && f.type === 'summon')).toBe(true)

    const closed = await (closeTool.execute as Function)({ id: opened.id }, { signal: new AbortController().signal })
    expect(closed.closed).toBe(true)
    const listedAfter = await (listTool.execute as Function)({}, { signal: new AbortController().signal })
    expect(listedAfter).toHaveLength(0)

    gateway.dispose()
    await manager.closeAll()
  })
})
