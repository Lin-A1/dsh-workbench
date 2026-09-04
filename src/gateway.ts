/**
 * Multi-channel WebSocket gateway for collaborative workbench surfaces.
 * Multiplexes terminal, browser, and git operations over a single secure connection.
 * @module dsh-workbench/gateway
 */

import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import type { JournalStore } from './terminal/journal.ts'
import type { WorkbenchTerminalManager } from './terminal/manager.ts'
import type { ProfileStore } from './terminal/profiles.ts'
import type { TerminalOpenRequest, WorkbenchBrowserTab, WorkbenchClientFrame, WorkbenchServerFrame } from './protocol.ts'

interface WebServerFace {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  registerUpgrade(route: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }): () => void
}

export interface GatewayOptions {
  terminalManager: WorkbenchTerminalManager
  profileStore: ProfileStore
  journalStore: JournalStore
  trustedHosts?: readonly string[]
}

const MAX_FRAME_BYTES = 64 * 1024

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

export function registerWorkbenchGateway(ctx: Context, options: GatewayOptions): WorkbenchGateway {
  const webServer = (ctx as unknown as { webServer?: WebServerFace }).webServer
  if (!webServer) {
    throw new Error('dsh-workbench requires the webServer service; please install into a web profile')
  }

  const gateway = new WorkbenchGateway(options)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-workbench/snapshot',
    handler: (req, res) => { void gateway.handleSnapshot(req, res) },
  }), 'workbench: snapshot route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-workbench/preview',
    handler: (req, res) => { void gateway.handlePreview(req, res) },
  }), 'workbench: local preview route')

  ctx.effect(() => webServer.registerUpgrade({
    path: '/dsh-workbench/ws',
    handler: (req, socket, head) => {
      if (!isTrustedRequest(req, options.trustedHosts ?? [])) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, ws => gateway.handleConnection(ws))
    },
  }), 'workbench: websocket route')

  ctx.effect(() => () => {
    gateway.dispose()
    wss.close()
  }, 'workbench: gateway teardown')

  ctx.effect(() => options.terminalManager.onChange(() => gateway.broadcastTerminals()), 'workbench: terminal changes')

  return gateway
}

interface Attachment {
  disposers: (() => void)[]
}

export class WorkbenchGateway {
  private readonly sockets = new Set<WebSocket>()
  private readonly socketSessions = new Map<WebSocket, string | undefined>()
  private readonly attachments = new Map<WebSocket, Map<string, Attachment>>()
  private readonly browserTabs = new Map<string, WorkbenchBrowserTab>()
  private tabSeq = 0
  private disposed = false

  constructor(private readonly options: GatewayOptions) {}

  async handleSnapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' || !isTrustedRequest(req, this.options.trustedHosts ?? [])) {
      res.writeHead(req.method !== 'GET' ? 405 : 403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: req.method !== 'GET' ? 'method not allowed' : 'untrusted' }))
      return
    }
    const body = {
      ok: true,
      terminals: this.options.terminalManager.collaborationViews(),
      profiles: await this.options.profileStore.list(),
      browserTabs: [...this.browserTabs.values()],
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  async handlePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') {
      res.writeHead(405).end('Method Not Allowed')
      return
    }
    try {
      const url = new URL(req.url ?? '', 'http://127.0.0.1')
      let filePath = url.searchParams.get('file')
      if (!filePath) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('missing ?file= parameter')
        return
      }

      // Strip file:// prefix if present
      if (filePath.startsWith('file:///')) {
        filePath = decodeURIComponent(filePath.slice(process.platform === 'win32' ? 8 : 7))
      }
      else if (filePath.startsWith('file://')) {
        filePath = decodeURIComponent(filePath.slice(7))
      }

      const canonicalPath = resolve(filePath)
      const st = await stat(canonicalPath)
      if (!st.isFile()) {
        res.writeHead(404).end('Not a file')
        return
      }

      const ext = extname(canonicalPath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const content = await readFile(canonicalPath)

      res.writeHead(200, {
        'content-type': contentType,
        'content-length': content.length,
        'x-content-type-options': 'nosniff',
      })
      res.end(content)
    }
    catch (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`File preview error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  handleConnection(ws: WebSocket): void {
    if (this.disposed) {
      ws.close()
      return
    }
    this.sockets.add(ws)
    this.attachments.set(ws, new Map())

    ws.on('message', data => this.handleMessage(ws, data.toString()))
    ws.on('close', () => {
      this.detachAll(ws)
      this.sockets.delete(ws)
      this.attachments.delete(ws)
      this.socketSessions.delete(ws)
    })
    ws.on('error', () => { /* no-op */ })
    void this.sendHello(ws)
  }

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let frame: WorkbenchClientFrame
    try {
      frame = JSON.parse(raw) as WorkbenchClientFrame
    }
    catch {
      this.send(ws, { channel: 'error', message: 'malformed frame: not JSON' })
      return
    }

    try {
      await this.route(ws, frame)
    }
    catch (err) {
      this.send(ws, { channel: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  private async route(ws: WebSocket, frame: WorkbenchClientFrame): Promise<void> {
    if (frame.channel === 'workbench') {
      if (frame.type === 'hello') {
        if (frame.sessionId) this.socketSessions.set(ws, frame.sessionId)
        await this.sendHello(ws, frame.sessionId)
      }
      return
    }

    if (frame.channel === 'browser') {
      switch (frame.type) {
        case 'open': {
          this.openBrowserTab(frame.url, frame.title, frame.sessionId ?? this.socketSessions.get(ws))
          return
        }
        case 'close': {
          this.closeBrowserTab(frame.id)
          return
        }
        case 'list': {
          const sessionId = frame.sessionId ?? this.socketSessions.get(ws)
          this.send(ws, { channel: 'browser', type: 'tabs', tabs: this.listBrowserTabs(sessionId) })
          return
        }
      }
      return
    }

    if (frame.channel === 'terminal') {
      switch (frame.type) {
        case 'list': {
          const sessionId = frame.sessionId ?? this.socketSessions.get(ws)
          this.send(ws, { channel: 'terminal', type: 'terminals', terminals: this.options.terminalManager.collaborationViews(sessionId) })
          return
        }
        case 'ensure': {
          const sessionId = frame.sessionId ?? this.socketSessions.get(ws)
          const current = this.options.terminalManager.collaborationViews(sessionId)
          if (current.length === 0) {
            await this.openTerminal(ws, {
              kind: 'local',
              name: '本地终端',
              sessionId,
              cwd: frame.cwd,
              echo: true,
            })
          }
          else {
            this.send(ws, { channel: 'terminal', type: 'terminals', terminals: current })
          }
          return
        }
        case 'attach': {
          await this.attachTerminal(ws, frame.id)
          return
        }
        case 'detach': {
          this.detachTerminal(ws, frame.id)
          this.send(ws, { channel: 'terminal', type: 'detached', id: frame.id })
          return
        }
        case 'input': {
          this.options.terminalManager.get(frame.id).humanWrite(String(frame.data ?? ''))
          return
        }
        case 'resize': {
          this.options.terminalManager.get(frame.id).resize(Number(frame.rows), Number(frame.cols))
          return
        }
        case 'open': {
          await this.openTerminal(ws, frame.request ?? {})
          return
        }
        case 'close': {
          const outcome = await this.options.terminalManager.close(frame.id)
          this.send(ws, { channel: 'terminal', type: 'closed', id: frame.id, outcome })
          return
        }
        case 'profiles:save': {
          await this.options.profileStore.upsert(frame.profile)
          await this.broadcastProfiles()
          return
        }
        case 'profiles:delete': {
          await this.options.profileStore.remove(frame.name)
          await this.broadcastProfiles()
          return
        }
      }
      return
    }

    if (frame.channel === 'git') {
      this.send(ws, { channel: 'git', type: 'status', status: null })
    }
  }

  openBrowserTab(url: string, title?: string, sessionId?: string): WorkbenchBrowserTab {
    const id = `wb-page-${++this.tabSeq}`
    const resolvedTitle = title || this.deriveTitle(url)
    const tab: WorkbenchBrowserTab = { id, url, title: resolvedTitle, sessionId }
    this.browserTabs.set(id, tab)

    const frame: WorkbenchServerFrame = { channel: 'browser', type: 'opened', tab }
    for (const ws of this.sockets) {
      this.send(ws, frame)
    }
    return tab
  }

  closeBrowserTab(id: string): void {
    if (this.browserTabs.delete(id)) {
      const frame: WorkbenchServerFrame = { channel: 'browser', type: 'closed', id }
      for (const ws of this.sockets) {
        this.send(ws, frame)
      }
    }
  }

  listBrowserTabs(sessionId?: string): WorkbenchBrowserTab[] {
    let list = [...this.browserTabs.values()]
    if (sessionId) {
      list = list.filter(t => !t.sessionId || t.sessionId === sessionId)
    }
    return list
  }

  private deriveTitle(rawUrl: string): string {
    try {
      if (rawUrl.startsWith('file://')) {
        const parts = rawUrl.split(/[\\/]/)
        return parts[parts.length - 1] || '本地文档'
      }
      const u = new URL(rawUrl)
      return u.hostname || rawUrl
    }
    catch {
      return rawUrl.slice(0, 20)
    }
  }

  private async sendHello(ws: WebSocket, sessionId?: string): Promise<void> {
    const activeSessionId = sessionId ?? this.socketSessions.get(ws)
    this.send(ws, {
      channel: 'workbench',
      type: 'hello',
      terminals: this.options.terminalManager.collaborationViews(activeSessionId),
      profiles: await this.options.profileStore.list(),
      browserTabs: this.listBrowserTabs(activeSessionId),
      sessionId: activeSessionId,
    })
  }

  private async attachTerminal(ws: WebSocket, id: string): Promise<void> {
    this.detachTerminal(ws, id)
    const session = this.options.terminalManager.get(id)
    const journal = await this.options.journalStore.replayTail(id)
    // Fresh sessions have no journal yet; the live display buffer still holds
    // the shell banner and prompt — replay it so attach never lands black.
    const replayText = journal.text.length > 0 ? journal.text : session.displayBacklog()
    const disposers: (() => void)[] = []

    disposers.push(session.subscribeOutput(text => this.send(ws, { channel: 'terminal', type: 'output', id, text })))
    disposers.push(session.onActivity(entry => this.send(ws, { channel: 'terminal', type: 'activity', id, entry })))
    disposers.push(session.onClose(() => {
      this.send(ws, { channel: 'terminal', type: 'closed', id, outcome: 'closed' })
      this.detachTerminal(ws, id)
    }))

    this.attachments.get(ws)?.set(id, { disposers })
    this.send(ws, { channel: 'terminal', type: 'attached', id, view: session.collaborationView(), replay: { text: replayText, truncated: journal.truncated } })
  }

  private detachTerminal(ws: WebSocket, id: string): void {
    const attachment = this.attachments.get(ws)?.get(id)
    if (attachment === undefined) return
    this.attachments.get(ws)?.delete(id)
    for (const d of attachment.disposers) d()
  }

  private detachAll(ws: WebSocket): void {
    const map = this.attachments.get(ws)
    if (!map) return
    for (const attachment of map.values()) {
      for (const d of attachment.disposers) d()
    }
    map.clear()
  }

  private async openTerminal(ws: WebSocket, request: TerminalOpenRequest): Promise<void> {
    let base = request.profile ? await this.options.profileStore.get(request.profile) : undefined
    const kind = request.kind ?? base?.kind ?? (request.host ? 'ssh' : 'local')

    const { snapshot, motd } = await this.options.terminalManager.open({
      kind,
      name: request.name ?? base?.name,
      sessionId: request.sessionId ?? this.socketSessions.get(ws),
      cwd: request.cwd ?? base?.cwd,
      host: request.host ?? base?.host,
      user: request.user ?? base?.user,
      port: request.port ?? base?.port,
      identityFile: request.identityFile ?? base?.identityFile,
      password: request.password,
      echo: request.echo ?? base?.echo,
    })

    const view = this.options.terminalManager.get(snapshot.terminalId).collaborationView()
    this.send(ws, { channel: 'terminal', type: 'opened', view, motd })
  }

  broadcastTerminals(): void {
    for (const ws of this.sockets) {
      const sessionId = this.socketSessions.get(ws)
      this.send(ws, {
        channel: 'terminal',
        type: 'terminals',
        terminals: this.options.terminalManager.collaborationViews(sessionId),
      })
    }
  }

  private async broadcastProfiles(): Promise<void> {
    const profiles = await this.options.profileStore.list()
    for (const ws of this.sockets) {
      this.send(ws, { channel: 'terminal', type: 'profiles', profiles })
    }
  }

  private send(ws: WebSocket, frame: WorkbenchServerFrame): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(frame))
    }
  }

  dispose(): void {
    this.disposed = true
    for (const ws of this.sockets) {
      this.detachAll(ws)
      ws.close()
    }
    this.sockets.clear()
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost'
    || /^127\.\d+\.\d+\.\d+$/.test(host)
    || host === '::1'
    || host.startsWith('::ffff:127.')
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  }
  catch {
    return undefined
  }
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return entryUrl.port === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

function isTrustedRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = req.headers.host
  if (!host) return false
  const hostUrl = parseAuthority(host)
  if (!hostUrl) return false
  const loopback = isLoopbackHostname(hostUrl.hostname)
  if (!loopback && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === hostUrl.host
  }
  catch {
    return false
  }
}
