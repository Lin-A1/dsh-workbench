/**
 * Pure, full-height collaborative terminal viewport.
 * Zero redundant nested subtabs: 100% focused on xterm.js execution,
 * with convertEol: true, 16-color ANSI theme, and auto-focus.
 * @module dsh-workbench/client/terminal/TerminalView
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useEffect, useRef, useState } from 'react'
import { workbenchClient } from '../ws.ts'

export interface TerminalViewProps {
  activeTerminalId: string
  isBusy?: boolean
  onError?: (msg: string) => void
}

interface TermHandle {
  term: Terminal
  fit: FitAddon
  observer: ResizeObserver
  /** Re-measure the host and, when the grid changed, tell the shell its size. */
  applyFit: (force?: boolean) => void
}

export function TerminalView({ activeTerminalId, isBusy, onError }: TerminalViewProps): JSX.Element {
  const terms = useRef(new Map<string, TermHandle>())
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(Boolean(isBusy))
  const [flashLock, setFlashLock] = useState(false)
  const busyRef = useRef(Boolean(isBusy))
  // The callback identity must not re-run the frame subscription: every
  // re-subscribe opens a window in which frames are dropped, and a dropped
  // `attached` frame is a terminal that stays blank.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    busyRef.current = Boolean(isBusy || busy)
  }, [isBusy, busy])

  useEffect(() => {
    setBusy(Boolean(isBusy))
  }, [isBusy])

  useEffect(() => {
    const dispose = workbenchClient.onFrame((frame) => {
      if (frame.channel !== 'terminal') return

      switch (frame.type) {
        case 'busy': {
          if (frame.id === activeTerminalId) {
            setBusy(frame.busy)
            busyRef.current = frame.busy
          }
          break
        }
        case 'attached': {
          if (frame.id !== activeTerminalId) break
          const handle = terms.current.get(frame.id)
          if (!handle) break
          handle.term.reset()
          if (frame.replay.text.length > 0) {
            handle.term.write(frame.replay.text)
          }
          if (frame.view?.busy !== undefined) {
            setBusy(frame.view.busy)
            busyRef.current = frame.view.busy
          }
          handle.term.focus()
          break
        }
        case 'output': {
          if (frame.id === activeTerminalId) {
            terms.current.get(frame.id)?.term.write(frame.text)
          }
          break
        }
      }
    })

    const disposeErrors = workbenchClient.onFrame((frame) => {
      if (frame.channel === 'error') {
        onErrorRef.current?.(frame.message)
      }
    })

    return () => {
      dispose()
      disposeErrors()
    }
  }, [activeTerminalId])

  // Mount/update xterm viewport
  useEffect(() => {
    const host = hostRef.current
    if (!activeTerminalId || !host) return

    let handle = terms.current.get(activeTerminalId)
    if (!handle) {
      const term = new Terminal({
        convertEol: true,
        fontSize: 13,
        lineHeight: 1.25,
        fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 2,
        scrollback: 10000,
        theme: {
          background: '#131316',
          foreground: '#d9dadd',
          cursor: '#b8b9be',
          cursorAccent: '#131316',
          selectionBackground: 'rgba(170, 172, 178, 0.32)',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#ffffff',
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      term.onData((data) => {
        if (busyRef.current) {
          // Allow Ctrl+C emergency interrupt to reach shell
          if (data === '\x03') {
            workbenchClient.send({ channel: 'terminal', type: 'input', id: activeTerminalId, data })
          }
          else {
            setFlashLock(true)
            setTimeout(() => setFlashLock(false), 800)
          }
          return
        }
        workbenchClient.send({ channel: 'terminal', type: 'input', id: activeTerminalId, data })
      })

      // Fit synchronously whenever the box changes, and only emit a resize
      // frame when the grid actually changed so a drag does not flood the
      // socket. This must NOT be deferred to requestAnimationFrame: xterm
      // itself paints through rAF, and a throttled or unfocused tab never runs
      // those callbacks — deferring the fit left the terminal frozen at a stale
      // size (a 1-column screen) after a split-width drag.
      let lastBox = ''
      const applyFit = (force = false): void => {
        const box = `${host.clientWidth}x${host.clientHeight}`
        if (!force && box === lastBox) return
        lastBox = box
        const before = `${term.rows}x${term.cols}`
        try {
          fit.fit()
        }
        catch {
          return
        }
        const { rows, cols } = term
        if (rows > 1 && cols > 1 && `${rows}x${cols}` !== before) {
          workbenchClient.send({ channel: 'terminal', type: 'resize', id: activeTerminalId, rows, cols })
        }
      }

      // The column width is the harness's business now (its drag handle holds
      // pointer capture), so this viewport watches its own box and nothing
      // else: a width change of any origin arrives through this observer.
      const observer = new ResizeObserver(() => applyFit())
      observer.observe(host)
      handle = { term, fit, observer, applyFit }
      terms.current.set(activeTerminalId, handle)
    }

    host.appendChild(handle.term.element ?? document.createElement('div'))
    handle.applyFit(true)
    if (typeof document !== 'undefined' && 'fonts' in document) {
      // A late webfont changes the cell metrics, so re-fit once it lands.
      void document.fonts.ready.then(() => handle?.applyFit(true))
    }
    handle.term.focus()
    workbenchClient.send({ channel: 'terminal', type: 'attach', id: activeTerminalId })

    return () => {
      handle?.term.element?.remove()
    }
  }, [activeTerminalId])

  return (
    <div className="wb-term-pure-viewport">
      {(isBusy || busy) && (
        <div className={`wb-term-busy-banner${flashLock ? ' flash' : ''}`}>
          <span className="wb-term-busy-pulse" />
          <span>AI 正在执行命令 · 按键保护已生效（按 Ctrl+C 可中断）</span>
        </div>
      )}
      <div className="wb-xterm-host" ref={hostRef} />
    </div>
  )
}
