/**
 * Durable session output journal for workbench terminals.
 * @module dsh-workbench/terminal/journal
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { WriteStream } from 'node:fs'
import type { WorkbenchTerminalSession } from './session.ts'

const REPLAY_TAIL_BYTES = 256 * 1024

interface OutputRecord {
  t: 'output'
  at: number
  text: string
}

export class JournalStore {
  private readonly streams = new Map<string, WriteStream>()
  private warned = false

  constructor(private readonly dataDir: string) {}

  get dir(): string {
    return join(this.dataDir, 'sessions')
  }

  attach(session: WorkbenchTerminalSession): void {
    void this.attachAsync(session)
  }

  private async attachAsync(session: WorkbenchTerminalSession): Promise<void> {
    const disposeOutput = session.subscribeOutput(chunk => this.write(session, chunk))
    try {
      await mkdir(this.dir, { recursive: true })
      const stream = createWriteStream(join(this.dir, `${session.snapshot().terminalId}.jsonl`), { flags: 'a' })
      stream.on('error', () => {
        this.warn('journal write failed; session continues without persistence')
        this.streams.delete(session.snapshot().terminalId)
        disposeOutput()
      })
      this.streams.set(session.snapshot().terminalId, stream)
      const backlog = session.displayBacklog()
      if (backlog.length > 0) this.write(session, backlog)
      session.onClose(() => {
        disposeOutput()
        const active = this.streams.get(session.snapshot().terminalId)
        this.streams.delete(session.snapshot().terminalId)
        active?.end()
      })
    }
    catch (error) {
      this.warn(`journal attach failed: ${error instanceof Error ? error.message : String(error)}`)
      disposeOutput()
    }
  }

  private write(session: WorkbenchTerminalSession, text: string): void {
    const stream = this.streams.get(session.snapshot().terminalId)
    if (stream === undefined) return
    const record: OutputRecord = { t: 'output', at: Date.now(), text }
    try {
      stream.write(`${JSON.stringify(record)}\n`)
    }
    catch (error) {
      this.warn(`journal write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async replayTail(terminalId: string): Promise<{ text: string; truncated: boolean }> {
    const file = join(this.dir, `${terminalId}.jsonl`)
    let size: number
    try {
      size = (await stat(file)).size
    }
    catch {
      return { text: '', truncated: false }
    }
    const start = Math.max(0, size - REPLAY_TAIL_BYTES)
    let content: string
    try {
      const handle = await readFile(file)
      content = handle.toString('utf8')
    }
    catch (error) {
      this.warn(`journal replay failed: ${error instanceof Error ? error.message : String(error)}`)
      return { text: '', truncated: false }
    }
    const lines = content.split('\n')
    if (start > 0) lines.shift()
    let text = ''
    for (const line of lines) {
      if (line.length === 0) continue
      try {
        const record = JSON.parse(line) as OutputRecord
        if (record.t === 'output') text += record.text
      }
      catch {
        // ignore broken lines
      }
    }
    return { text, truncated: start > 0 }
  }

  async forget(terminalId: string): Promise<void> {
    const file = join(this.dir, `${terminalId}.jsonl`)
    try {
      await rename(file, `${file}.deleted-${Date.now()}`)
    }
    catch {
      // ignore
    }
  }

  private warn(message: string): void {
    if (this.warned) return
    this.warned = true
    console.warn(`[dsh-workbench] ${message}`)
  }
}
