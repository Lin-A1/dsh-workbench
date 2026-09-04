/**
 * Reconnecting WebSocket client for the workbench multi-channel gateway.
 * @module dsh-workbench/client/ws
 */

import type { WorkbenchClientFrame, WorkbenchServerFrame } from '../protocol.ts'

type FrameListener = (frame: WorkbenchServerFrame) => void
type StateListener = (connected: boolean) => void

const MAX_BACKOFF_MS = 10_000

export class WorkbenchClient {
  private ws: WebSocket | undefined
  private readonly frameListeners = new Set<FrameListener>()
  private readonly stateListeners = new Set<StateListener>()
  private readonly attachedTerminals = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retry = 0
  private stopped = false
  private connected = false
  private currentSessionId: string | undefined
  private pending: WorkbenchClientFrame[] = []

  setSessionId(sessionId?: string): void {
    if (this.currentSessionId !== sessionId) {
      this.currentSessionId = sessionId
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ channel: 'workbench', type: 'hello', sessionId } satisfies WorkbenchClientFrame))
      }
    }
  }

  start(): void {
    this.stopped = false
    if (this.ws !== undefined) return
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = undefined
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.connected)
    return () => { this.stateListeners.delete(listener) }
  }

  send(frame: WorkbenchClientFrame): void {
    if (frame.channel === 'terminal') {
      if (frame.type === 'attach') this.attachedTerminals.add(frame.id)
      if (frame.type === 'detach') this.attachedTerminals.delete(frame.id)
      if (frame.type === 'close') this.attachedTerminals.delete(frame.id)
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame))
      return
    }
    // Socket disconnected or still connecting: queue lifecycle and user intent
    // frames so clicking "New Terminal" or switching views during reconnect never drops.
    if (!this.stopped && this.pending.length < 128) {
      this.pending.push(frame)
    }
  }

  private open(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/dsh-workbench/ws`)
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      this.setConnected(true)
      // Request fresh snapshot on reconnect; do not blindly attach stale IDs from prior processes
      this.attachedTerminals.clear()
      ws.send(JSON.stringify({ channel: 'workbench', type: 'hello', sessionId: this.currentSessionId } satisfies WorkbenchClientFrame))
      for (const frame of this.pending) ws.send(JSON.stringify(frame))
      this.pending = []
    }

    ws.onmessage = (event) => {
      let frame: WorkbenchServerFrame
      try {
        frame = JSON.parse(String(event.data)) as WorkbenchServerFrame
      }
      catch {
        return
      }
      for (const listener of this.frameListeners) listener(frame)
    }

    ws.onclose = () => {
      this.setConnected(false)
      this.ws = undefined
      if (this.stopped) {
        this.pending = []
        return
      }
      // Agile reconnect: capped at 2s instead of long exponential backoff
      const delay = Math.min(2000, 350 * (this.retry + 1))
      this.retry += 1
      this.retryTimer = setTimeout(() => this.open(), delay)
    }

    ws.onerror = () => { /* wait for close */ }
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return
    this.connected = connected
    for (const listener of this.stateListeners) listener(connected)
  }
}

export const workbenchClient = new WorkbenchClient()
