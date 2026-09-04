/**
 * Session registry: lifecycle, allowlist, and bounds for both local and SSH terminals.
 * Supports filtering by the active conversation sessionId.
 * @module dsh-workbench/terminal/manager
 */

import { hostAllowed } from './allowlist.ts'
import { connectLocal } from './local.ts'
import { WorkbenchTerminalSession } from './session.ts'
import { connectSsh } from './ssh.ts'
import type { TerminalStore } from './store.ts'
import type { ActivityEntry, TerminalCollaborationView, TerminalConnection, TerminalKind, TerminalSnapshot } from '../types.ts'

export const INITIAL_COLS = 220
export const INITIAL_ROWS = 50

export interface ManagerOptions {
  allowlist: readonly string[]
  maxSessions: number
  defaultPort: number
  connectTimeoutMs: number
  maxScrollbackBytes: number
  keepaliveIntervalMs?: number
  connectSsh?: typeof connectSsh
  connectLocal?: typeof connectLocal
  onOpen?: (session: WorkbenchTerminalSession) => void
  terminalStore?: TerminalStore
}

export interface OpenOptions {
  id?: string
  kind: TerminalKind
  name?: string
  sessionId?: string
  cwd?: string
  // SSH fields
  host?: string
  user?: string
  port?: number
  identityFile?: string
  password?: string
  echo?: boolean
}

export type DetailedTerminalView = TerminalCollaborationView & { recentActivity: ActivityEntry[] }

export class WorkbenchTerminalManager {
  private readonly sessions = new Map<string, WorkbenchTerminalSession>()
  private readonly changeListeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly options: ManagerOptions) {}

  async restorePersisted(): Promise<number> {
    if (!this.options.terminalStore) return 0
    const specs = await this.options.terminalStore.list()
    let restored = 0
    for (const spec of specs) {
      if (this.sessions.has(spec.id)) continue
      try {
        await this.open({
          id: spec.id,
          kind: spec.kind,
          name: spec.name,
          sessionId: spec.sessionId,
          cwd: spec.cwd,
          host: spec.host,
          user: spec.user,
          port: spec.port,
          identityFile: spec.identityFile,
          echo: spec.echo,
        })
        restored++
      }
      catch (err) {
        console.warn(`[dsh-workbench] failed to restore terminal ${spec.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return restored
  }

  async open(req: OpenOptions): Promise<{ snapshot: TerminalSnapshot; motd: string }> {
    if (req.id && this.sessions.has(req.id)) {
      const existing = this.sessions.get(req.id)!
      return { snapshot: existing.snapshot(), motd: '' }
    }

    if (this.sessions.size >= this.options.maxSessions) {
      throw new Error(`workbench: session limit ${this.options.maxSessions} reached`)
    }

    const id = req.id || `wb-term-${process.pid}-${++this.seq}`
    let connection: TerminalConnection

    if (req.kind === 'ssh') {
      if (!req.host || req.host.trim().length === 0) throw new Error('ssh host must be provided')
      if (!req.user || req.user.trim().length === 0) throw new Error('ssh user must be provided')
      if (!hostAllowed(req.host, this.options.allowlist)) {
        throw new Error(`workbench: host ${JSON.stringify(req.host)} is not in the allowlist`)
      }
      const connectFn = this.options.connectSsh ?? connectSsh
      const port = req.port ?? this.options.defaultPort
      connection = await connectFn({
        host: req.host,
        user: req.user,
        port,
        identityFile: req.identityFile,
        password: req.password,
        connectTimeoutMs: this.options.connectTimeoutMs,
        keepaliveIntervalMs: this.options.keepaliveIntervalMs,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      })
    }
    else {
      const connectFn = this.options.connectLocal ?? connectLocal
      connection = await connectFn({
        cwd: req.cwd,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      })
    }

    const { session, motd } = await WorkbenchTerminalSession.start(
      id,
      {
        kind: req.kind,
        sessionId: req.sessionId,
        cwd: req.cwd,
        host: req.host,
        user: req.user,
        port: req.port,
        name: req.name,
      },
      connection,
      {
        echo: req.echo ?? (req.kind === 'local' ? true : false),
        maxScrollbackBytes: this.options.maxScrollbackBytes,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      },
      this.options.connectTimeoutMs,
    )

    this.sessions.set(id, session)
    session.onClose(() => this.notifyChange())
    this.options.onOpen?.(session)

    if (this.options.terminalStore) {
      void this.options.terminalStore.save({
        id,
        kind: req.kind,
        name: req.name,
        sessionId: req.sessionId,
        cwd: req.cwd,
        host: req.host,
        user: req.user,
        port: req.port,
        identityFile: req.identityFile,
        echo: req.echo,
        createdAt: Date.now(),
      })
    }

    this.notifyChange()
    return { snapshot: session.snapshot(), motd }
  }

  get(terminalId: string): WorkbenchTerminalSession {
    const session = this.sessions.get(terminalId)
    if (session === undefined) throw new Error(`unknown terminal id ${JSON.stringify(terminalId)}`)
    return session
  }

  list(sessionId?: string): TerminalSnapshot[] {
    let list = [...this.sessions.values()].map(s => s.snapshot())
    if (sessionId) {
      // If scoped, match exact sessionId or unassociated sessions
      list = list.filter(s => !s.sessionId || s.sessionId === sessionId)
    }
    return list
  }

  collaborationViews(sessionId?: string): TerminalCollaborationView[] {
    let list = [...this.sessions.values()].map(s => s.collaborationView())
    if (sessionId) {
      list = list.filter(s => !s.sessionId || s.sessionId === sessionId)
    }
    return list
  }

  listDetailed(activityLimit: number, sessionId?: string): DetailedTerminalView[] {
    let list = [...this.sessions.values()]
    if (sessionId) {
      list = list.filter(s => !s.snapshot().sessionId || s.snapshot().sessionId === sessionId)
    }
    return list.map(s => ({
      ...s.collaborationView(),
      recentActivity: s.recentActivity(activityLimit),
    }))
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) listener()
  }

  async close(terminalId: string): Promise<'closed' | 'already-closing'> {
    const session = this.get(terminalId)
    this.sessions.delete(terminalId)
    void this.options.terminalStore?.remove(terminalId)
    const outcome = await session.close() ? 'closed' : 'already-closing'
    this.notifyChange()
    return outcome
  }

  async closeAll(): Promise<void> {
    const pending = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(pending.map(s => s.close()))
    this.notifyChange()
  }
}
