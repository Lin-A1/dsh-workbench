/**
 * Multi-channel WebSocket gateway for collaborative workbench surfaces.
 * Multiplexes terminal, git, and browser operations over a single secure connection.
 * @module dsh-workbench/gateway
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import type { JournalStore } from './terminal/journal.ts'
import type { WorkbenchTerminalManager } from './terminal/manager.ts'
import type { ProfileStore } from './terminal/profiles.ts'
import type { TerminalOpenRequest, WorkbenchClientFrame, WorkbenchServerFrame } from './protocol.ts'

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

export function registerWorkbenchGateway(ctx: Context, options: GatewayOptions): void {
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
}

interface Attachment {
  disposers: (() => void)[]
}

export class WorkbenchGateway {
  private readonly sockets = new Set<WebSocket>()
  private readonly socketSessions = new Map<WebSocket, string | undefined>()
  private readonly attachments = new Map<WebSocket, Map<string, Attachment>>()
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
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
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

    if (frame.channel === 'terminal') {
      switch (frame.type) {
        case 'list': {
          const sessionId = frame.sessionId ?? this.socketSessions.get(ws)
          this.send(ws, { channel: 'terminal', type: 'terminals', terminals: this.options.terminalManager.collaborationViews(sessionId) })
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
      // Phase 2 hook
      this.send(ws, { channel: 'git', type: 'status', status: null })
    }
  }

  private async sendHello(ws: WebSocket, sessionId?: string): Promise<void> {
    const activeSessionId = sessionId ?? this.socketSessions.get(ws)
    this.send(ws, {
      channel: 'workbench',
      type: 'hello',
      terminals: this.options.terminalManager.collaborationViews(activeSessionId),
      profiles: await this.options.profileStore.list(),
      sessionId: activeSessionId,
    })
  }

  private async attachTerminal(ws: WebSocket, id: string): Promise<void> {
    this.detachTerminal(ws, id)
    const session = this.options.terminalManager.get(id)
    const journal = await this.options.journalStore.replayTail(id)
    const disposers: (() => void)[] = []

    disposers.push(session.subscribeOutput(text => this.send(ws, { channel: 'terminal', type: 'output', id, text })))
    disposers.push(session.onActivity(entry => this.send(ws, { channel: 'terminal', type: 'activity', id, entry })))
    disposers.push(session.onClose(() => {
      this.send(ws, { channel: 'terminal', type: 'closed', id, outcome: 'closed' })
      this.detachTerminal(ws, id)
    }))

    this.attachments.get(ws)?.set(id, { disposers })
    this.send(ws, { channel: 'terminal', type: 'attached', id, view: session.collaborationView(), replay: journal })
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
