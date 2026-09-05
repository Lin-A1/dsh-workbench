import type { ShellChannel, TerminalConnection } from '../src/types.ts'

export class FakeShell implements ShellChannel {
  readonly writes: string[] = []
  readonly resizes: { rows: number; cols: number }[] = []
  private dataListeners: ((chunk: string) => void)[] = []
  private closeListeners: (() => void)[] = []
  /** Optional test hook: react to a write by emitting synthetic output. */
  onWrite?: (data: string) => void

  write(data: string): void {
    this.writes.push(data)
    const ready = /printf '(__DSHWB_READY_[A-Za-z0-9_]+__)\\n'/.exec(data)?.[1]
    const done = /printf '(__DSHWB_DONE_[A-Za-z0-9_]+__):%s\\n'/.exec(data)?.[1]
    if (ready !== undefined) this.emit(`welcome\n${ready}\n`)
    if (done !== undefined) this.emit(`command output\n${done}:0\n`)
    if (ready === undefined && done === undefined) this.emit('raw input output\n')
    this.onWrite?.(data)
  }

  close(): void {
    for (const listener of this.closeListeners) listener()
  }

  resize(rows: number, cols: number): void {
    this.resizes.push({ rows, cols })
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener)
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener)
  }

  emit(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk)
  }

  emitClose(): void {
    for (const listener of this.closeListeners) listener()
  }
}

export class FakeConnection implements TerminalConnection {
  readonly shell = new FakeShell()
  closeCount = 0

  async openShell(): Promise<ShellChannel> {
    return this.shell
  }

  close(): void {
    this.closeCount += 1
  }
}
