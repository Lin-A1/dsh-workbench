/**
 * Shared types for the collaborative workbench plugin.
 * @module dsh-workbench/types
 */

export type ActivitySource = 'human' | 'model'

/** Attributed input record. */
export interface ActivityEntry {
  source: ActivitySource
  text: string
  at: number
}

export type TerminalKind = 'local' | 'ssh'

export type TerminalStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }

/** Underlying shell channel abstraction. */
export interface ShellChannel {
  write(data: string): void
  close(): void
  onData(listener: (chunk: string) => void): void
  onClose(listener: () => void): void
  resize?(rows: number, cols: number): void
}

/** Established connection handle. */
export interface TerminalConnection {
  openShell(): Promise<ShellChannel>
  close(): void
}

/** Basic snapshot of a terminal session. */
export interface TerminalSnapshot {
  terminalId: string
  name?: string
  kind: TerminalKind
  sessionId?: string
  cwd?: string
  host?: string
  user?: string
  port?: number
  status: TerminalStatus
}

/** Collaboration view enriched with live stats for workbench UI. */
export interface TerminalCollaborationView extends TerminalSnapshot {
  unreadBytes: number
  cols: number
  rows: number
}

export type SendWaitReason = 'command_done' | 'inferred_idle' | 'timeout' | 'session_exit'

export interface SendResult {
  output: string
  waitReason: SendWaitReason
  exitCode: number | null
  status: 'running' | 'exited'
  truncated: boolean
}

export interface ReadResult {
  text: string
  totalLines: number
  lineBegin: number
  lineEnd: number
  truncated: boolean
}
