/**
 * Pure, full-height collaborative terminal viewport.
 * Zero redundant nested subtabs: 100% focused on xterm.js execution,
 * with convertEol: true, 16-color ANSI theme, and auto-focus.
 * @module dsh-workbench/client/terminal/TerminalView
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useEffect, useRef } from 'react'
import { workbenchClient } from '../ws.ts'

export interface TerminalViewProps {
  activeTerminalId: string
  onError?: (msg: string) => void
}

interface TermHandle {
  term: Terminal
  fit: FitAddon
  observer: ResizeObserver
}

export function TerminalView({ activeTerminalId, onError }: TerminalViewProps): JSX.Element {
  const terms = useRef(new Map<string, TermHandle>())
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const dispose = workbenchClient.onFrame((frame) => {
      if (frame.channel !== 'terminal') return

      switch (frame.type) {
        case 'attached': {
          if (frame.id !== activeTerminalId) break
          const handle = terms.current.get(frame.id)
          if (!handle) break
          handle.term.reset()
          if (frame.replay.text.length > 0) {
            handle.term.write(frame.replay.text)
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
        onError?.(frame.message)
      }
    })

    return () => {
      dispose()
      disposeErrors()
    }
  }, [activeTerminalId, onError])

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
          background: '#0a0d12',
          foreground: '#d1d7e0',
          cursor: '#58a6ff',
          cursorAccent: '#0a0d12',
          selectionBackground: 'rgba(56, 139, 253, 0.35)',
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
      term.onData(data => workbenchClient.send({ channel: 'terminal', type: 'input', id: activeTerminalId, data }))

      const observer = new ResizeObserver(() => {
        try { fit.fit() } catch { /* ignore */ }
        const { rows, cols } = term
        if (rows > 1 && cols > 1) {
          workbenchClient.send({ channel: 'terminal', type: 'resize', id: activeTerminalId, rows, cols })
        }
      })
      observer.observe(host)
      handle = { term, fit, observer }
      terms.current.set(activeTerminalId, handle)
    }

    host.appendChild(handle.term.element ?? document.createElement('div'))
    try {
      handle.fit.fit()
      handle.term.focus()
    }
    catch {
      /* ignore */
    }
    workbenchClient.send({ channel: 'terminal', type: 'attach', id: activeTerminalId })

    return () => {
      handle?.term.element?.remove()
    }
  }, [activeTerminalId])

  return (
    <div className="wb-term-pure-viewport">
      <div className="wb-xterm-host" ref={hostRef} />
    </div>
  )
}
