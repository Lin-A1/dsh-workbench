/**
 * Collaborative terminal component for the workbench view.
 * Multi-tab support for local shell & SSH, with live activity attribution.
 * @module dsh-workbench/client/terminal/TerminalView
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalCollaborationView, TerminalKind } from '../../types.ts'
import type { TerminalOpenRequest, TerminalProfile } from '../../protocol.ts'
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

  // Auto-select first terminal if current selection is invalid
  useEffect(() => {
    if (terminals.length > 0 && (!activeId || !terminals.some(t => t.terminalId === activeId))) {
      setActiveId(terminals[0].terminalId)
    }
    else if (terminals.length === 0) {
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
    if (!activeId || !host) return

    let handle = terms.current.get(activeId)
    if (!handle) {
      const term = new Terminal({
        fontSize: 13,
        fontFamily: 'Consolas, "Fira Code", "Courier New", monospace',
        cursorBlink: true,
        scrollback: 5000,
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: 'rgba(56, 139, 253, 0.4)',
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      term.onData(data => workbenchClient.send({ channel: 'terminal', type: 'input', id: activeId, data }))

      const observer = new ResizeObserver(() => {
        try { fit.fit() } catch { /* zero size guard */ }
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
    try { handle.fit.fit() } catch { /* zero size guard */ }
    workbenchClient.send({ channel: 'terminal', type: 'attach', id: activeId })

    return () => {
      handle?.term.element?.remove()
    }
  }, [activeId])

  const activeTerminal = useMemo(
    () => terminals.find(t => t.terminalId === activeId),
    [terminals, activeId],
  )

  return (
    <div className="wb-term-root">
      <div className="wb-term-subtabs">
        {terminals.map(t => (
          <button
            key={t.terminalId}
            type="button"
            className={`wb-subtab${t.terminalId === activeId && !formOpen ? ' active' : ''}`}
            onClick={() => {
              setFormOpen(false)
              setActiveId(t.terminalId)
            }}
            title={t.kind === 'ssh' ? `${t.user}@${t.host}:${t.port}` : `Local Shell (${t.cwd || 'default'})`}
          >
            <span className={`wb-dot ${t.status.kind === 'running' ? 'ok' : 'dead'}`} />
            <span>{t.name ?? (t.kind === 'ssh' ? `${t.user}@${t.host}` : '本地终端')}</span>
            {t.unreadBytes > 0 ? <span className="wb-unread">•</span> : null}
            <span
              className="wb-subtab-close"
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                workbenchClient.send({ channel: 'terminal', type: 'close', id: t.terminalId })
              }}
            >
              ×
            </span>
          </button>
        ))}

        <button
          type="button"
          className={`wb-subtab${formOpen || terminals.length === 0 ? ' active' : ''}`}
          onClick={() => setFormOpen(true)}
        >
          + 新建终端
        </button>

        <span className="wb-spacer" />

        {activeTerminal ? (
          <span className="wb-term-info">
            {activeTerminal.kind === 'ssh'
              ? `SSH: ${activeTerminal.user}@${activeTerminal.host}:${activeTerminal.port}`
              : `本地 Shell (${activeTerminal.cwd || '当前目录'})`}
            {' · '}
            {activeTerminal.rows}×{activeTerminal.cols}
          </span>
        ) : null}
      </div>

      <div className="wb-term-viewport">
        {formOpen || terminals.length === 0 ? (
          <ConnectForm
            profiles={profiles}
            sessionId={sessionId}
            error={formError}
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
    </div>
  )
}

function ConnectForm({ profiles, sessionId, error, onOpen, onSaveProfile }: {
  profiles: TerminalProfile[]
  sessionId?: string
  error?: string
  onOpen: (request: TerminalOpenRequest) => void
  onSaveProfile: (profile: TerminalProfile) => void
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
        <h3>创建协作终端</h3>
        <p>支持创建当前会话关联的本地终端，或连接远端 SSH 服务器。人机在同一终端操作，AI 实时可见。</p>
      </div>

      {profiles.length > 0 ? (
        <div className="wb-form-row">
          <label>预设档案</label>
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
            <option value="">选择已保存档案…</option>
            {profiles.map(p => (
              <option key={p.name} value={p.name}>{p.name} ({p.kind})</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="wb-form-row">
        <label>终端类型</label>
        <div className="wb-radio-group">
          <label className="wb-radio">
            <input type="radio" checked={kind === 'local'} onChange={() => setKind('local')} />
            <span>本地 Shell (当前项目工作区)</span>
          </label>
          <label className="wb-radio">
            <input type="radio" checked={kind === 'ssh'} onChange={() => setKind('ssh')} />
            <span>远程 SSH 会话</span>
          </label>
        </div>
      </div>

      <div className="wb-form-grid">
        <label>终端名称</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'local' ? '本地开发终端' : 'deploy-server'} />

        {kind === 'ssh' ? (
          <>
            <label>远程主机</label>
            <input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
            <label>SSH 端口</label>
            <input value={port} onChange={e => setPort(e.target.value)} placeholder="22" />
            <label>登录用户</label>
            <input value={user} onChange={e => setUser(e.target.value)} placeholder="root" />
            <label>私钥路径</label>
            <input value={identityFile} onChange={e => setIdentityFile(e.target.value)} placeholder="C:\Users\...\.ssh\id_rsa" />
            <label>登录密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空使用私钥验证" />
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
          启动终端
        </button>

        <input
          className="wb-input-save"
          placeholder="另存为档案名…"
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
          保存配置
        </button>
      </div>
    </div>
  )
}
