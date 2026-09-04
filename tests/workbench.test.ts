import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { WorkbenchGateway } from '../src/gateway.ts'
import { createTools, resolveConfig } from '../src/index.ts'
import type { WorkbenchServerFrame } from '../src/protocol.ts'
import { JournalStore } from '../src/terminal/journal.ts'
import { WorkbenchTerminalManager } from '../src/terminal/manager.ts'
import { ProfileStore } from '../src/terminal/profiles.ts'
import { createSentinelLineFilter, stripSentinel } from '../src/terminal/sentinel.ts'
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

const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15))

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
    expect(chunks.join('')).toContain('[AI] $')
    expect(chunks.join('')).toContain('echo test')

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
})
