/**
 * Session registry: lifecycle, allowlist, and bounds for both local and SSH terminals.
 * Terminals are owned by exactly one conversation session and listed strictly
 * per session, so two sessions never share a workspace or a shell.
 * @module dsh-workbench/terminal/manager
 */

import { existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { hostAllowed } from './allowlist.ts'
import { connectLocal } from './local.ts'
import { WorkbenchTerminalSession } from './session.ts'
import { connectSsh } from './ssh.ts'
import type { TerminalStore } from './store.ts'
import type { ActivityEntry, TerminalCollaborationView, TerminalConnection, TerminalKind, TerminalSnapshot } from '../types.ts'

export const INITIAL_COLS = 220
export const INITIAL_ROWS = 50

/**
 * Resolve a sensible working directory for a new local terminal when neither
 * the caller nor the session header named one: walk up from the dsh-web
 * process's cwd to the nearest directory holding a project marker (.git,
 * package.json, Cargo.toml, pyproject.toml, go.mod, …). Sessions with a
 * recorded workspace never reach this — their terminals inherit the
 * conversation's own directory.
 */
function resolveSmartCwd(): string {
  const start = process.cwd()
  const markers = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle']
  let dir = resolve(start)
  while (true) {
    for (const m of markers) {
      if (existsSync(join(dir, m))) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

function defaultLocalCwd(): string {
  try {
    return resolveSmartCwd()
  }
  catch {
    return process.cwd()
  }
}

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

/**
 * A referenced terminal id is not open. Carries the ids that ARE open so the
 * caller — a model tool, or a browser tab reconnecting after a service restart
 * — can self-correct instead of retrying a dead handle.
 */
export class UnknownTerminalError extends Error {
  /**
   * @param terminalId - the id that did not resolve.
   * @param available - ids of every terminal currently open.
   */
  constructor(readonly terminalId: string, readonly available: readonly string[]) {
    super(available.length === 0
      ? `unknown terminal id ${JSON.stringify(terminalId)}: no workbench terminal is open — open one with workbench_terminal_open`
      : `unknown terminal id ${JSON.stringify(terminalId)}: open terminals are ${available.map(id => JSON.stringify(id)).join(', ')} — call workbench_terminal_list to refresh the list`)
    this.name = 'UnknownTerminalError'
  }
}

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
      if (this.sessions.size >= this.options.maxSessions) break
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
        // A spec whose shell cannot be respawned (deleted cwd, refused host) is
        // dead weight: keeping it makes every boot retry it, it holds a session
        // slot, and its id keeps haunting tool calls that still remember it.
        console.warn(`[dsh-workbench] dropping unrestorable terminal ${spec.id}: ${err instanceof Error ? err.message : String(err)}`)
        void this.options.terminalStore.remove(spec.id)
      }
    }
    return restored
  }

  /**
   * Bind orphan terminals to a conversation. "Orphan" means the client-side
   * filter would otherwise hide it forever: it never had an owner, or its
   * owner is a conversation the session store no longer holds. Every terminal
   * then belongs to exactly one live session, which is what lets the
   * per-session filter stay both complete and tight.
   * @param terminalIds - terminals to claim.
   * @param sessionId - the session claiming them.
   */
  async adopt(terminalIds: readonly string[], sessionId: string): Promise<void> {
    let claimed = 0
    for (const id of terminalIds) {
      const session = this.sessions.get(id)
      if (session === undefined) continue
      session.adoptSession(sessionId)
      claimed++
      const view = session.collaborationView()
      if (this.options.terminalStore) {
        void this.options.terminalStore.save({
          id: view.terminalId,
          kind: view.kind,
          name: view.name,
          sessionId,
          cwd: view.cwd,
          host: view.host,
          user: view.user,
          port: view.port,
          echo: true,
          createdAt: Date.now(),
        })
      }
    }
    if (claimed > 0) this.notifyChange()
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
      // Local shells: if the caller didn't specify a cwd, default to the
      // nearest project root above the dsh-web process's cwd so the new
      // terminal lands in the project the user is actually working on.
      const localCwd = req.cwd ?? defaultLocalCwd()
      const connectFn = this.options.connectLocal ?? connectLocal
      connection = await connectFn({
        cwd: localCwd,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      })
      req = { ...req, cwd: localCwd }
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
    if (session === undefined) throw new UnknownTerminalError(terminalId, [...this.sessions.keys()])
    return session
  }

  has(terminalId: string): boolean {
    return this.sessions.has(terminalId)
  }

  /** Ids of every open terminal, for error messages and diagnostics. */
  ids(): string[] {
    return [...this.sessions.keys()]
  }

  /**
   * Terminals of one conversation. A scoped call returns ONLY that session's
   * own terminals — unscoped terminals are adopted at connect time
   * ({@link adoptUnscoped}), so nothing is hidden and nothing leaks into other
   * conversations the way the old "unscoped matches everything" rule did.
   */
  list(sessionId?: string): TerminalSnapshot[] {
    let list = [...this.sessions.values()].map(s => s.snapshot())
    if (sessionId) {
      list = list.filter(s => s.sessionId === sessionId)
    }
    return list
  }

  collaborationViews(sessionId?: string): TerminalCollaborationView[] {
    let list = [...this.sessions.values()].map(s => s.collaborationView())
    if (sessionId) {
      list = list.filter(s => s.sessionId === sessionId)
    }
    return list
  }

  listDetailed(activityLimit: number, sessionId?: string): DetailedTerminalView[] {
    let list = [...this.sessions.values()]
    if (sessionId) {
      list = list.filter(s => s.snapshot().sessionId === sessionId)
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
