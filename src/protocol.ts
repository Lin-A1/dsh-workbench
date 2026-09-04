/**
 * Wire protocol for the collaborative workbench.
 * Multi-channel JSON-framed protocol over WebSocket.
 * @module dsh-workbench/protocol
 */

import type { ActivityEntry, TerminalCollaborationView, TerminalKind } from './types.ts'

/** Connection profile definition. */
export interface TerminalProfile {
  name: string
  kind: TerminalKind
  host?: string
  user?: string
  port?: number
  identityFile?: string
  echo?: boolean
  cwd?: string
}

export interface TerminalOpenRequest {
  profile?: string
  kind?: TerminalKind
  name?: string
  sessionId?: string
  cwd?: string
  host?: string
  user?: string
  port?: number
  identityFile?: string
  password?: string
  echo?: boolean
}

export interface ReplayTail {
  text: string
  truncated: boolean
}

export interface WorkbenchBrowserTab {
  id: string
  url: string
  title: string
  sessionId?: string
}

/** Client -> Server Frames */
export type WorkbenchClientFrame =
  | { channel: 'workbench'; type: 'hello'; sessionId?: string }
  | { channel: 'terminal'; type: 'list'; sessionId?: string }
  | { channel: 'terminal'; type: 'ensure'; sessionId?: string; cwd?: string }
  | { channel: 'terminal'; type: 'open'; request: TerminalOpenRequest }
  | { channel: 'terminal'; type: 'attach'; id: string }
  | { channel: 'terminal'; type: 'detach'; id: string }
  | { channel: 'terminal'; type: 'input'; id: string; data: string }
  | { channel: 'terminal'; type: 'resize'; id: string; rows: number; cols: number }
  | { channel: 'terminal'; type: 'close'; id: string }
  | { channel: 'terminal'; type: 'profiles:save'; profile: TerminalProfile }
  | { channel: 'terminal'; type: 'profiles:delete'; name: string }
  | { channel: 'browser'; type: 'open'; url: string; title?: string; sessionId?: string }
  | { channel: 'browser'; type: 'close'; id: string }
  | { channel: 'browser'; type: 'list'; sessionId?: string }
  | { channel: 'git'; type: 'status'; sessionId?: string; cwd?: string }

/** Server -> Client Frames */
export type WorkbenchServerFrame =
  | { channel: 'workbench'; type: 'hello'; terminals: TerminalCollaborationView[]; profiles: TerminalProfile[]; browserTabs?: WorkbenchBrowserTab[]; sessionId?: string }
  | { channel: 'workbench'; type: 'summon' }
  | { channel: 'terminal'; type: 'terminals'; terminals: TerminalCollaborationView[] }
  | { channel: 'terminal'; type: 'attached'; id: string; view: TerminalCollaborationView; replay: ReplayTail }
  | { channel: 'terminal'; type: 'detached'; id: string }
  | { channel: 'terminal'; type: 'output'; id: string; text: string }
  | { channel: 'terminal'; type: 'activity'; id: string; entry: ActivityEntry }
  | { channel: 'terminal'; type: 'opened'; view: TerminalCollaborationView; motd: string }
  | { channel: 'terminal'; type: 'busy'; id: string; busy: boolean; actor?: 'model' | 'human' }
  | { channel: 'terminal'; type: 'closed'; id: string; outcome: 'closed' | 'already-closing' }
  | { channel: 'terminal'; type: 'profiles'; profiles: TerminalProfile[] }
  | { channel: 'browser'; type: 'tabs'; tabs: WorkbenchBrowserTab[] }
  | { channel: 'browser'; type: 'opened'; tab: WorkbenchBrowserTab }
  | { channel: 'browser'; type: 'closed'; id: string }
  | { channel: 'git'; type: 'status'; status: unknown }
  | { channel: 'error'; message: string }
