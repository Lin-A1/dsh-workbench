/**
 * Collaborative terminal session supporting both local and remote (SSH) processes.
 * Dual-audience: model sends commands with sentinels; humans type directly with
 * live activity attribution and xterm.js streaming.
 * @module dsh-workbench/terminal/session
 */

import type { ActivityEntry, ActivitySource, ReadResult, SendResult, ShellChannel, TerminalCollaborationView, TerminalConnection, TerminalKind, TerminalSnapshot, TerminalStatus } from '../types.ts'
import { sanitizeTerminalText } from './ansi.ts'
import { createDoneToken, createReadyToken, createSentinelLineFilter, stripMarkerLines, stripSentinel } from './sentinel.ts'

const encoder = new TextEncoder()
const ACTIVITY_TEXT_LIMIT = 200
const ACTIVITY_RING_LIMIT = 50
const HUMAN_COALESCE_MS = 600

export interface SessionOptions {
  echo: boolean
  maxScrollbackBytes: number
  cols: number
  rows: number
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
    probeTimeoutMs: number,
  ): Promise<{ session: WorkbenchTerminalSession; motd: string }> {
    const shell = await connection.openShell()
    const session = new WorkbenchTerminalSession(id, meta, connection, shell, options)
    try {
      const motd = await session.probe(probeTimeoutMs)
      session.markModelSeen()
      return { session, motd }
    }
    catch (error) {
      connection.close()
      throw error
    }
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

  private probe(timeoutMs: number): Promise<string> {
    const token = createReadyToken(this.id)
    const prefix = this.options.echo ? '' : 'stty -echo 2>/dev/null || true; '
    const mark = this.pos
    return new Promise((resolve, reject) => {
      const onData = (): void => {
        const { text } = this.sliceFrom(mark)
        if (!text.includes(token)) return
        cleanup()
        resolve(sanitizeTerminalText(stripMarkerLines(text, token)))
      }
      const onClose = (): void => {
        cleanup()
        reject(new Error(`terminal ${this.id}: shell closed during startup`))
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(sanitizeTerminalText(stripMarkerLines(this.sliceFrom(mark).text, token)))
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        this.dataListeners.delete(onData)
        this.closeListeners.delete(onClose)
      }
      this.dataListeners.add(onData)
      this.closeListeners.add(onClose)
      this.shell.write(`${prefix}printf '${token}\\n'\n`)
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
    this.noteInput('human', data)
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

  private noteInput(source: ActivitySource, text: string): void {
    if (source === 'model') {
      this.flushHumanInput()
      this.pushActivity({ source, text: ellipsize(text), at: Date.now() })
      return
    }
    this.humanPending += text
    if (this.humanPending.includes('\n') || this.humanPending.includes('\r') || this.humanPending.length >= 200) {
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
