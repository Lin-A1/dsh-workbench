/**
 * Collaborative terminal session supporting both local and remote (SSH) processes.
 * Dual-audience: model sends commands with sentinels; humans type directly with
 * live activity attribution and xterm.js streaming.
 * @module dsh-workbench/terminal/session
 */

import type { ActivityEntry, ActivitySource, ReadResult, SendResult, ShellChannel, TerminalCollaborationView, TerminalConnection, TerminalKind, TerminalSnapshot, TerminalStatus } from '../types.ts'
import { sanitizeTerminalText } from './ansi.ts'
import { createDoneToken, createSentinelLineFilter, stripSentinel } from './sentinel.ts'

const encoder = new TextEncoder()
const ACTIVITY_TEXT_LIMIT = 200
const ACTIVITY_RING_LIMIT = 50
const HUMAN_COALESCE_MS = 600

/** Silence after the last startup byte that counts as "the banner is done". */
export const DEFAULT_STARTUP_QUIET_MS = 300
/** Hard ceiling on waiting for a banner, whatever the connect timeout says. */
const STARTUP_MAX_WAIT_MS = 2500

/**
 * Has the shell said anything a human could read yet? Escape sequences and
 * the payloads inside them do not count — an OSC window title carries the
 * shell's own path, which would otherwise pass for a banner.
 */
function hasReadableLine(display: string): boolean {
  return sanitizeTerminalText(display).length > 0
}

export interface SessionOptions {
  echo: boolean
  maxScrollbackBytes: number
  cols: number
  rows: number
  /** Silence window that ends startup capture; tests lower it to stay fast. */
  startupQuietMs: number
}

export interface SendRequest {
  data: string
  submit: boolean
  idleMs: number
  timeoutMs: number
  signal?: AbortSignal
}

interface WaitRequest {
  mark: number
  token?: string
  idleMs: number
  timeoutMs: number
  signal?: AbortSignal
}

export class WorkbenchTerminalSession {
  private buf = ''
  private displayBuf = ''
  private trimmedChars = 0
  private seq = 0
  private pending = false
  private readonly dataListeners = new Set<() => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly outputSubscribers = new Set<(chunk: string) => void>()
  private readonly activityListeners = new Set<(entry: ActivityEntry) => void>()
  private readonly busyListeners = new Set<(busy: boolean, actor?: 'model' | 'human') => void>()
  private readonly filter = createSentinelLineFilter()
  private readonly activity: ActivityEntry[] = []
  private humanPending = ''
  private humanTimer: NodeJS.Timeout | undefined
  private modelSeen = 0
  private closed = false
  private status: TerminalStatus = { kind: 'running' }
  private cols: number
  private rows: number

  private constructor(
    private readonly id: string,
    private readonly meta: {
      kind: TerminalKind
      sessionId?: string
      cwd?: string
      host?: string
      user?: string
      port?: number
      name?: string
    },
    private readonly connection: TerminalConnection,
    private readonly shell: ShellChannel,
    private readonly options: SessionOptions,
  ) {
    this.cols = options.cols
    this.rows = options.rows
    shell.onData(chunk => this.feed(chunk))
    shell.onClose(() => this.handleClose())
  }

  static async start(
    id: string,
    meta: {
      kind: TerminalKind
      sessionId?: string
      cwd?: string
      host?: string
      user?: string
      port?: number
      name?: string
    },
    connection: TerminalConnection,
    options: SessionOptions,
    startupTimeoutMs: number,
  ): Promise<{ session: WorkbenchTerminalSession; banner: Promise<string> }> {
    const shell = await connection.openShell()
    const session = new WorkbenchTerminalSession(id, meta, connection, shell, options)
    // The banner resolves in the background on purpose. A Windows login shell
    // spends over a second in its profile scripts before saying anything, and
    // making the panel wait that long to show a tab would be paying a
    // model-facing nicety out of the human's latency budget. The promise never
    // rejects: a shell that dies while starting up is already visible through
    // the session's own status and close event.
    const banner = session.captureStartup(startupTimeoutMs).then((text) => {
      session.markModelSeen()
      return text
    }, () => '')
    return { session, banner }
  }

  private get pos(): number {
    return this.trimmedChars + this.buf.length
  }

  private feed(chunk: string): void {
    const normalized = chunk.replace(/\r\n/g, '\n')
    this.buf += normalized
    if (encoder.encode(this.buf).byteLength > this.options.maxScrollbackBytes) {
      const cut = this.buf.indexOf('\n', Math.floor(this.buf.length / 2))
      if (cut > 0) {
        this.buf = this.buf.slice(cut + 1)
        this.trimmedChars += cut + 1
      }
    }
    const display = this.filter(normalized)
    if (display.length > 0) {
      // Ensure every newline sent to interactive terminal has carriage return (\r\n) to prevent staircase effect
      const termDisplay = display.replace(/(?<!\r)\n/g, '\r\n')
      this.displayBuf += termDisplay
      if (encoder.encode(this.displayBuf).byteLength > this.options.maxScrollbackBytes) {
        const cut = this.displayBuf.indexOf('\n', Math.floor(this.displayBuf.length / 2))
        if (cut > 0) this.displayBuf = this.displayBuf.slice(cut + 1)
      }
      for (const subscriber of this.outputSubscribers) subscriber(termDisplay)
    }
    for (const listener of this.dataListeners) listener()
  }

  private handleClose(): void {
    if (this.status.kind === 'exited') return
    this.status = { kind: 'exited', exitCode: null, signal: null }
    for (const listener of this.closeListeners) listener()
  }

  private sliceFrom(mark: number): { text: string; truncated: boolean } {
    const rel = mark - this.trimmedChars
    if (rel <= 0) return { text: this.buf, truncated: this.trimmedChars > 0 }
    return { text: this.buf.slice(rel), truncated: false }
  }

  /**
   * Wait for the shell to finish announcing itself, then return what it said.
   *
   * Deliberately passive. The previous version wrote a sentinel `printf` into
   * the shell to prove it was live; the shell answered with a fresh prompt that
   * the sentinel line filter could not eat (it only drops lines carrying the
   * marker), so every newly opened terminal showed its banner twice — and the
   * injected command was appended to the user's shell history. A PTY is live
   * the moment it spawns, so the only thing worth waiting for is the banner it
   * prints unprompted: watch for silence instead of poking it.
   *
   * Resolves with the sanitized startup text, which is empty for a shell that
   * says nothing until spoken to (a pipe-spawned bash).
   */
  private captureStartup(timeoutMs: number): Promise<string> {
    const maxWait = Math.max(1, Math.min(timeoutMs, STARTUP_MAX_WAIT_MS))
    return new Promise((resolve, reject) => {
      let quiet: NodeJS.Timeout | undefined
      const settle = (): void => {
        cleanup()
        resolve(sanitizeTerminalText(this.displayBuf))
      }
      const onData = (): void => {
        // A ConPTY shell announces itself in pieces: Git Bash first writes a
        // burst of pure mode-setting escapes, then spends a few hundred
        // milliseconds in /etc/profile, then prints the banner. Silence only
        // means "done" once there is something readable to have finished —
        // otherwise the window closes during the profile run and the banner
        // lands after the capture already gave up on it.
        if (!hasReadableLine(this.displayBuf)) return
        if (quiet !== undefined) clearTimeout(quiet)
        quiet = setTimeout(settle, this.options.startupQuietMs)
      }
      const onClose = (): void => {
        cleanup()
        // Dying before saying anything means the shell never came up; dying
        // after saying something leaves a banner worth keeping.
        if (this.displayBuf.length > 0) resolve(sanitizeTerminalText(this.displayBuf))
        else reject(new Error(`terminal ${this.id}: shell closed during startup`))
      }
      const timer = setTimeout(settle, maxWait)
      const cleanup = (): void => {
        clearTimeout(timer)
        if (quiet !== undefined) clearTimeout(quiet)
        this.dataListeners.delete(onData)
        this.closeListeners.delete(onClose)
      }
      this.dataListeners.add(onData)
      this.closeListeners.add(onClose)
      // The only write startup still owns: a caller that asked for a silent
      // line discipline gets the mode change, nothing else.
      if (!this.options.echo) this.shell.write('stty -echo 2>/dev/null || true\n')
    })
  }

  displayBacklog(): string {
    return this.displayBuf
  }

  subscribeOutput(listener: (chunk: string) => void): () => void {
    this.outputSubscribers.add(listener)
    return () => { this.outputSubscribers.delete(listener) }
  }

  onActivity(listener: (entry: ActivityEntry) => void): () => void {
    this.activityListeners.add(listener)
    return () => { this.activityListeners.delete(listener) }
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => { this.closeListeners.delete(listener) }
  }

  onBusyChange(listener: (busy: boolean, actor?: 'model' | 'human') => void): () => void {
    this.busyListeners.add(listener)
    return () => { this.busyListeners.delete(listener) }
  }

  isBusy(): boolean {
    return this.pending
  }

  busyActor(): 'model' | 'human' | undefined {
    return this.pending ? 'model' : undefined
  }

  private setBusy(busy: boolean, actor?: 'model' | 'human'): void {
    this.pending = busy
    for (const listener of this.busyListeners) {
      listener(busy, actor)
    }
  }

  recentActivity(limit: number): ActivityEntry[] {
    return this.activity.slice(Math.max(0, this.activity.length - limit))
  }

  resize(rows: number, cols: number): void {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2) return
    this.rows = rows
    this.cols = cols
    this.shell.resize?.(rows, cols)
  }

  size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows }
  }

  humanWrite(data: string): void {
    if (this.closed || this.status.kind === 'exited') {
      throw new Error(`terminal ${this.id} is closed`)
    }
    if (this.pending) {
      // While the model has a command in-flight, protect the command
      // stream and sentinel protocol from keystroke corruption.
      // Allow Ctrl+C (\x03) through so the human operator can interrupt
      // a runaway command if needed.
      if (data === '\x03') {
        this.shell.write(data)
        this.noteInput('human', '^C')
      }
      return
    }
    this.shell.write(data)
    // A pipe-spawned shell has no TTY line discipline to echo keystrokes
    // back; mirror them into the display stream so the human sees what they
    // type. Only the display is fed — the AI-facing command buffer must not
    // receive synthetic text.
    if (this.shell.echoesInput === false && data.length > 0) {
      this.writeDisplay(mirrorKeystrokes(data))
    }
    this.noteInput('human', readableInput(data), /[\r\n]/.test(data))
  }

  /** Append to the human-facing display only (no AI buffer, no dataListeners). */
  private writeDisplay(text: string): void {
    const termDisplay = text.replace(/(?<!\r)\n/g, '\r\n')
    this.displayBuf += termDisplay
    if (encoder.encode(this.displayBuf).byteLength > this.options.maxScrollbackBytes) {
      const cut = this.displayBuf.indexOf('\n', Math.floor(this.displayBuf.length / 2))
      if (cut > 0) this.displayBuf = this.displayBuf.slice(cut + 1)
    }
    for (const subscriber of this.outputSubscribers) subscriber(termDisplay)
  }

  /**
   * @param source - who typed it.
   * @param text - the attributable text: raw for the model, readable keystrokes
   *   for a human.
   * @param submits - whether the keystroke completed the line. It ends the
   *   coalescing window immediately, which the cleaned text cannot signal on
   *   its own: Enter is stripped from the recorded value.
   */
  private noteInput(source: ActivitySource, text: string, submits = false): void {
    if (source === 'model') {
      this.flushHumanInput()
      this.pushActivity({ source, text: ellipsize(text), at: Date.now() })
      return
    }
    // A keystroke that carries no text — an arrow key, a bare modifier chord —
    // is navigation, not an operation. Recording it would fill the feed with
    // escape-sequence noise and make the human's real command unreadable.
    if (text.length === 0 && !submits) return
    this.humanPending += text
    if (submits || this.humanPending.includes('\n') || this.humanPending.length >= 200) {
      this.flushHumanInput()
      return
    }
    if (this.humanTimer !== undefined) clearTimeout(this.humanTimer)
    this.humanTimer = setTimeout(() => this.flushHumanInput(), HUMAN_COALESCE_MS)
  }

  private flushHumanInput(): void {
    if (this.humanTimer !== undefined) {
      clearTimeout(this.humanTimer)
      this.humanTimer = undefined
    }
    if (this.humanPending.length === 0) return
    const text = this.humanPending
    this.humanPending = ''
    this.pushActivity({ source: 'human', text: ellipsize(text), at: Date.now() })
  }

  private pushActivity(entry: ActivityEntry): void {
    this.activity.push(entry)
    if (this.activity.length > ACTIVITY_RING_LIMIT) this.activity.shift()
    for (const listener of this.activityListeners) listener(entry)
  }

  unreadBytes(): number {
    return Math.max(0, this.pos - this.modelSeen)
  }

  markModelSeen(): void {
    this.modelSeen = this.pos
  }

  async send(req: SendRequest): Promise<SendResult> {
    if (this.closed || this.status.kind === 'exited') {
      throw new Error(`terminal ${this.id} is closed`)
    }
    if (this.pending) {
      throw new Error(`terminal ${this.id} already has a send in flight`)
    }
    if (req.signal?.aborted) throw new Error('terminal send aborted')
    this.setBusy(true, 'model')
    try {
      const mark = this.pos
      let token: string | undefined
      this.noteInput('model', req.data)
      // Broadcast an [AI] attribution marker to human terminal subscribers.
      // A real PTY echoes the typed command itself right after the write, so
      // repeating the command text here showed every model input twice; the
      // full text is only needed on pipe fallback shells where echo is off.
      const ptyEchoes = this.shell.echoesInput !== false
      const broadcastEcho = ptyEchoes
        ? `\r\n\x1b[38;5;75m[AI]$ \x1b[0m`
        : `\r\n\x1b[38;5;75m[AI] $\x1b[0m \x1b[1m${req.data.trim()}\x1b[0m\r\n`
      this.displayBuf += broadcastEcho
      for (const subscriber of this.outputSubscribers) subscriber(broadcastEcho)

      if (req.submit) {
        token = createDoneToken(this.id, ++this.seq)
        this.shell.write(`${req.data}\nprintf '${token}:%s\\n' "$?"\n`)
      }
      else {
        this.shell.write(req.data)
      }
      const result = await this.wait({ mark, token, idleMs: req.idleMs, timeoutMs: req.timeoutMs, signal: req.signal })
      this.markModelSeen()
      return result
    }
    finally {
      this.setBusy(false)
    }
  }

  private wait(req: WaitRequest): Promise<SendResult> {
    return new Promise((resolve, reject) => {
      let idleTimer: NodeJS.Timeout | undefined
      const finish = (waitReason: SendResult['waitReason'], exitCode: number | null = null): void => {
        cleanup()
        const { text, truncated } = this.sliceFrom(req.mark)
        let output = text
        if (req.token !== undefined) {
          const stripped = stripSentinel(text, req.token)
          if (stripped !== undefined) output = stripped.text
        }
        // Model-facing transcript is cooked: escapes stripped, TUI redraws
        // resolved — the raw byte storm from full-screen programs never
        // reaches the conversation.
        resolve({ output: sanitizeTerminalText(output), waitReason, exitCode, status: this.status.kind, truncated })
      }
      const onData = (): void => {
        if (req.token !== undefined) {
          const { text } = this.sliceFrom(req.mark)
          const hit = stripSentinel(text, req.token)
          if (hit !== undefined) {
            finish('command_done', hit.exitCode)
            return
          }
        }
        else {
          restartIdle()
        }
      }
      const onClose = (): void => finish('session_exit')
      const onAbort = (): void => {
        cleanup()
        reject(new Error('terminal send aborted'))
      }
      const restartIdle = (): void => {
        if (req.token !== undefined) return
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => finish('inferred_idle'), req.idleMs)
      }
      const timeoutTimer = setTimeout(() => finish('timeout'), req.timeoutMs)
      const cleanup = (): void => {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        clearTimeout(timeoutTimer)
        this.dataListeners.delete(onData)
        this.closeListeners.delete(onClose)
        req.signal?.removeEventListener('abort', onAbort)
      }
      this.dataListeners.add(onData)
      this.closeListeners.add(onClose)
      req.signal?.addEventListener('abort', onAbort)
      restartIdle()
      onData()
    })
  }

  read(offset: number, count: number): ReadResult {
    const lines = this.buf.split('\n')
    const totalLines = lines.length
    const end = Math.max(0, totalLines - Math.max(0, offset))
    const begin = Math.max(0, end - Math.max(1, count))
    this.markModelSeen()
    return {
      text: sanitizeTerminalText(lines.slice(begin, end).join('\n')),
      totalLines,
      lineBegin: begin,
      lineEnd: end,
      truncated: this.trimmedChars > 0,
    }
  }

  async close(): Promise<boolean> {
    const wasRunning = this.status.kind === 'running' && !this.closed
    this.closed = true
    this.flushHumanInput()
    if (wasRunning) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.closeListeners.delete(onClosed)
          resolve()
        }, 5000)
        const onClosed = (): void => {
          clearTimeout(timer)
          resolve()
        }
        this.closeListeners.add(onClosed)
        this.shell.close()
      })
    }
    this.connection.close()
    this.handleClose()
    return wasRunning
  }

  snapshot(): TerminalSnapshot {
    return { terminalId: this.id, ...this.meta, status: this.status }
  }

  /**
   * Bind this terminal to a conversation session. Used to claim terminals that
   * predate session attribution, so the strict per-session filter neither hides
   * them nor leaks them into every other conversation.
   * @param sessionId - the session taking ownership.
   */
  adoptSession(sessionId: string): void {
    this.meta.sessionId = sessionId
  }

  collaborationView(): TerminalCollaborationView {
    return {
      ...this.snapshot(),
      unreadBytes: this.unreadBytes(),
      cols: this.cols,
      rows: this.rows,
      busy: this.pending,
      busyActor: this.pending ? 'model' : undefined,
    }
  }
}

/**
 * Human keystrokes as the activity feed should show them: the text the person
 * actually typed, with the terminal's own vocabulary removed.
 *
 * A real PTY hands us every arrow key, focus event, and bracketed-paste toggle
 * as an escape sequence. Those say nothing about intent, and escaping them into
 * `^[[I` notation (which is what the feed used to do) turns one typed command
 * into a page of noise.
 */
function readableInput(data: string): string {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()*+#][0-9A-Za-z]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r/g, '')
}

function ellipsize(text: string): string {
  const normalized = text.replace(/\r/g, '')
  return normalized.length <= ACTIVITY_TEXT_LIMIT ? normalized : `${normalized.slice(0, ACTIVITY_TEXT_LIMIT)}…`
}

/**
 * Render human keystrokes the way a TTY line discipline would: printable
 * characters pass through, Enter breaks the line, backspace erases, control
 * chords show as ^-notation, and navigation escape sequences stay invisible.
 */
function mirrorKeystrokes(data: string): string {
  return data
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[a-zA-Z0-9=><]/g, '')
    .replace(/\x1b/g, '')
    .replace(/\r/g, '\r\n')
    .replace(/[\x08\x7f]/g, '\b \b')
    .replace(/[\x00-\x07\x0b\x0c\x0e-\x1f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`)
}
