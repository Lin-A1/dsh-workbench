/**
 * High-performance collaborative terminal view for the workbench sidebar.
 * Instant local shell readiness, clean SVG icons, auto-focus, zero emoji.
 * @module dsh-workbench/client/terminal/TerminalView
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalCollaborationView, TerminalKind } from '../../types.ts'
import type { TerminalOpenRequest, TerminalProfile } from '../../protocol.ts'
import { CloseIcon, FolderIcon, PlusIcon, ServerIcon } from '../icons.tsx'
import { workbenchClient } from '../ws.ts'

export interface TerminalViewProps {
  terminals: TerminalCollaborationView[]
  profiles: TerminalProfile[]
  sessionId?: string
  onError?: (msg: string) => void
}

interface TermHandle {
  term: Terminal
  fit: FitAddon
  observer: ResizeObserver
}

export function TerminalView({ terminals, profiles, sessionId, onError }: TerminalViewProps): JSX.Element {
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const pendingMotd = useRef(new Map<string, string>())
  const terms = useRef(new Map<string, TermHandle>())
  const hostRef = useRef<HTMLDivElement | null>(null)
  const ensuredRef = useRef(false)

  // Auto-ensure a local terminal exists when none present
  useEffect(() => {
    if (!ensuredRef.current && terminals.length === 0) {
      ensuredRef.current = true
      workbenchClient.send({ channel: 'terminal', type: 'ensure', sessionId })
    }
  }, [sessionId, terminals.length])

  // Select first terminal if needed
  useEffect(() => {
    if (terminals.length > 0 && (!activeId || !terminals.some(t => t.terminalId === activeId))) {
      setActiveId(terminals[0].terminalId)
    }
    else if (terminals.length === 0 && !ensuredRef.current) {
      setActiveId(undefined)
    }
  }, [terminals, activeId])

  useEffect(() => {
    const dispose = workbenchClient.onFrame((frame) => {
      if (frame.channel !== 'terminal') return

      switch (frame.type) {
        case 'opened': {
          setFormOpen(false)
          setFormError(undefined)
          pendingMotd.current.set(frame.view.terminalId, frame.motd)
          setActiveId(frame.view.terminalId)
          break
        }
        case 'attached': {
          const handle = terms.current.get(frame.id)
          if (!handle) break
          handle.term.reset()
          const motd = pendingMotd.current.get(frame.id)
          pendingMotd.current.delete(frame.id)
          if (frame.replay.text.length > 0) {
            handle.term.write(frame.replay.text)
          }
          else if (motd !== undefined) {
            handle.term.write(`${motd}\r\n`)
          }
          handle.term.focus()
          break
        }
        case 'output': {
          terms.current.get(frame.id)?.term.write(frame.text)
          break
        }
        case 'closed': {
          if (activeId === frame.id) {
            setActiveId(undefined)
          }
          break
        }
      }
    })

    const disposeErrors = workbenchClient.onFrame((frame) => {
      if (frame.channel === 'error') {
        setFormError(frame.message)
        onError?.(frame.message)
      }
    })

    return () => {
      dispose()
      disposeErrors()
    }
  }, [activeId, onError])

  // Mount/update xterm viewport
  useEffect(() => {
    const host = hostRef.current
    if (!activeId || !host || formOpen) return

    let handle = terms.current.get(activeId)
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
      term.onData(data => workbenchClient.send({ channel: 'terminal', type: 'input', id: activeId, data }))

      const observer = new ResizeObserver(() => {
        try { fit.fit() } catch { /* ignore */ }
        const { rows, cols } = term
        if (rows > 1 && cols > 1) {
          workbenchClient.send({ channel: 'terminal', type: 'resize', id: activeId, rows, cols })
        }
      })
      observer.observe(host)
      handle = { term, fit, observer }
      terms.current.set(activeId, handle)
    }

    host.appendChild(handle.term.element ?? document.createElement('div'))
    try {
      handle.fit.fit()
      handle.term.focus()
    }
    catch {
      /* ignore */
    }
    workbenchClient.send({ channel: 'terminal', type: 'attach', id: activeId })

    return () => {
      handle?.term.element?.remove()
    }
  }, [activeId, formOpen])

  const activeTerminal = useMemo(
    () => terminals.find(t => t.terminalId === activeId),
    [terminals, activeId],
  )

  return (
    <div className="wb-term-root">
      {/* 终端子标签导航栏 */}
      <div className="wb-term-subtabs">
        <div className="wb-term-tabs-scroll">
          {terminals.map(t => (
            <button
              key={t.terminalId}
              type="button"
              className={`wb-subtab${t.terminalId === activeId && !formOpen ? ' active' : ''}`}
              onClick={() => {
                setFormOpen(false)
                setActiveId(t.terminalId)
              }}
              title={t.kind === 'ssh' ? `${t.user}@${t.host}:${t.port}` : `本地 Shell (${t.cwd || '当前目录'})`}
            >
              <span className={`wb-dot ${t.status.kind === 'running' ? 'ok' : 'dead'}`} />
              {t.kind === 'ssh' ? <ServerIcon size={12} /> : <FolderIcon size={12} />}
              <span className="wb-subtab-title">{t.name ?? (t.kind === 'ssh' ? `${t.user}@${t.host}` : '本地终端')}</span>
              {t.unreadBytes > 0 ? <span className="wb-unread-pill">{t.unreadBytes}B</span> : null}
              <span
                className="wb-subtab-close"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  workbenchClient.send({ channel: 'terminal', type: 'close', id: t.terminalId })
                }}
              >
                <CloseIcon size={10} />
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`wb-subtab-add${formOpen ? ' active' : ''}`}
          onClick={() => setFormOpen(!formOpen)}
          title="新建终端或连接 SSH"
        >
          <PlusIcon size={13} />
        </button>
      </div>

      {/* 终端视口或新建表单 */}
      <div className="wb-term-viewport">
        {formOpen ? (
          <ConnectForm
            profiles={profiles}
            sessionId={sessionId}
            error={formError}
            onCancel={() => setFormOpen(false)}
            onOpen={(request) => {
              workbenchClient.send({ channel: 'terminal', type: 'open', request: { ...request, sessionId } })
            }}
            onSaveProfile={(profile) => {
              workbenchClient.send({ channel: 'terminal', type: 'profiles:save', profile })
            }}
          />
        ) : (
          <div className="wb-xterm-host" ref={hostRef} />
        )}
      </div>

      {/* 终端底部元信息 */}
      {activeTerminal && !formOpen ? (
        <div className="wb-term-footer">
          <span className="wb-footer-item">
            <span className={`wb-dot ${activeTerminal.status.kind === 'running' ? 'ok' : 'dead'}`} />
            <span>{activeTerminal.status.kind === 'running' ? '运行中' : '已退出'}</span>
          </span>
          <span className="wb-footer-spacer" />
          <span className="wb-footer-item wb-footer-mono">
            {activeTerminal.rows}×{activeTerminal.cols}
          </span>
          <span className="wb-footer-item wb-footer-mono">
            {activeTerminal.kind === 'ssh' ? `${activeTerminal.user}@${activeTerminal.host}` : (activeTerminal.cwd || '当前目录')}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function ConnectForm({ profiles, sessionId, error, onOpen, onSaveProfile, onCancel }: {
  profiles: TerminalProfile[]
  sessionId?: string
  error?: string
  onOpen: (request: TerminalOpenRequest) => void
  onSaveProfile: (profile: TerminalProfile) => void
  onCancel: () => void
}): JSX.Element {
  const [kind, setKind] = useState<TerminalKind>('local')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [user, setUser] = useState('')
  const [identityFile, setIdentityFile] = useState('')
  const [password, setPassword] = useState('')
  const [selectedProfile, setSelectedProfile] = useState('')
  const [saveAs, setSaveAs] = useState('')

  return (
    <div className="wb-form-container">
      <div className="wb-form-header">
        <div className="wb-form-title-row">
          <h4>新建协作终端</h4>
          <button type="button" className="wb-icon-btn" onClick={onCancel}>
            <CloseIcon size={14} />
          </button>
        </div>
        <p>创建本地 Shell 或 SSH 会话。人和 AI 共享操作同一终端，指令及输出实时双向同步。</p>
      </div>

      {profiles.length > 0 ? (
        <div className="wb-form-row">
          <label>快速选择</label>
          <select
            value={selectedProfile}
            onChange={(e) => {
              setSelectedProfile(e.target.value)
              const p = profiles.find(item => item.name === e.target.value)
              if (p) {
                setKind(p.kind)
                setName(p.name)
                setHost(p.host ?? '')
                setUser(p.user ?? '')
                setPort(String(p.port ?? 22))
                setIdentityFile(p.identityFile ?? '')
              }
            }}
          >
            <option value="">选择已有配置…</option>
            {profiles.map(p => (
              <option key={p.name} value={p.name}>{p.name} ({p.kind === 'ssh' ? 'SSH' : '本地'})</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="wb-form-row">
        <label>目标类型</label>
        <div className="wb-radio-group">
          <label className="wb-radio">
            <input type="radio" checked={kind === 'local'} onChange={() => setKind('local')} />
            <span>本地 Shell</span>
          </label>
          <label className="wb-radio">
            <input type="radio" checked={kind === 'ssh'} onChange={() => setKind('ssh')} />
            <span>远程 SSH</span>
          </label>
        </div>
      </div>

      <div className="wb-form-grid">
        <label>显示名称</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'local' ? '本地终端' : '远程部署机'} />

        {kind === 'ssh' ? (
          <>
            <label>远程主机</label>
            <input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
            <label>端口号</label>
            <input value={port} onChange={e => setPort(e.target.value)} placeholder="22" />
            <label>用户名</label>
            <input value={user} onChange={e => setUser(e.target.value)} placeholder="root" />
            <label>私钥路径</label>
            <input value={identityFile} onChange={e => setIdentityFile(e.target.value)} placeholder="C:\Users\...\id_rsa" />
            <label>登录密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空使用私钥" />
          </>
        ) : null}
      </div>

      {error ? <div className="wb-form-error">{error}</div> : null}

      <div className="wb-form-actions">
        <button
          type="button"
          className="wb-btn primary"
          onClick={() => {
            onOpen({
              kind,
              name: name.trim() || undefined,
              sessionId,
              host: host.trim() || undefined,
              port: Number.parseInt(port, 10) || undefined,
              user: user.trim() || undefined,
              identityFile: identityFile.trim() || undefined,
              password: password || undefined,
              echo: true,
            })
          }}
        >
          立即创建
        </button>

        <input
          className="wb-input-save"
          placeholder="配置档案名…"
          value={saveAs}
          onChange={e => setSaveAs(e.target.value)}
        />
        <button
          type="button"
          className="wb-btn"
          onClick={() => {
            if (!saveAs.trim()) return
            onSaveProfile({
              name: saveAs.trim(),
              kind,
              host: host.trim() || undefined,
              port: Number.parseInt(port, 10) || undefined,
              user: user.trim() || undefined,
              identityFile: identityFile.trim() || undefined,
              echo: true,
            })
            setSaveAs('')
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}
