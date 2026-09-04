/**
 * Collaborative Workspace Studio Component.
 * Unified single-tier Tab Strip with true half-screen split width, full
 * maximization, zero emoji, and seamless Browser / Terminal / Git flow.
 * @module dsh-workbench/client/WorkbenchSidebar
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import type { WorkbenchBrowserTab } from '../protocol.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { BrowserView } from './browser/BrowserView.tsx'
import { closeSidebarColumn, initResizeHandle, openSidebarColumn, toggleMaximize } from './column.ts'
import { ActivityIcon, CloseIcon, GitBranchIcon, GlobeIcon, MaximizeIcon, PlusIcon, ServerIcon, TerminalIcon } from './icons.tsx'
import { TerminalView } from './terminal/TerminalView.tsx'
import { workbenchClient } from './ws.ts'

export interface WorkbenchSidebarProps {
  sessionId?: string
  closeDetails?: () => void
}

export function WorkbenchSidebar({ sessionId, closeDetails }: WorkbenchSidebarProps): JSX.Element {
  const [activeTabId, setActiveTabId] = useState<string>('')
  const [terminals, setTerminals] = useState<TerminalCollaborationView[]>([])
  const [browserTabs, setBrowserTabs] = useState<WorkbenchBrowserTab[]>([])
  const [connected, setConnected] = useState(false)
  const [globalError, setGlobalError] = useState<string | undefined>(undefined)
  const [activityVersion, setActivityVersion] = useState(0)
  const [maximized, setMaximized] = useState(false)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [gitTabOpen, setGitTabOpen] = useState(false)
  const [activityTabOpen, setActivityTabOpen] = useState(false)

  const activityLog = useRef(new Map<string, ActivityEntry[]>())
  const ensuredRef = useRef(false)

  // Ensure default local terminal on first session load
  useEffect(() => {
    workbenchClient.setSessionId(sessionId)
    workbenchClient.start()

    if (!ensuredRef.current) {
      ensuredRef.current = true
      workbenchClient.send({ channel: 'terminal', type: 'ensure', sessionId })
    }

    const disposeFrames = workbenchClient.onFrame((frame) => {
      switch (frame.channel) {
        case 'workbench': {
          if (frame.type === 'hello') {
            setTerminals(frame.terminals)
            if (frame.browserTabs) setBrowserTabs(frame.browserTabs)
            if (frame.terminals.length > 0 && !activeTabId) {
              setActiveTabId(frame.terminals[0].terminalId)
            }
          }
          else if (frame.type === 'summon') {
            // The model opened a terminal/browser tab (or called workbench_show):
            // reveal the panel so its actions are visible to the human.
            openSidebarColumn()
          }
          break
        }
        case 'browser': {
          if (frame.type === 'tabs') {
            setBrowserTabs(frame.tabs)
          }
          else if (frame.type === 'opened') {
            setBrowserTabs(prev => [...prev.filter(t => t.id !== frame.tab.id), frame.tab])
            setActiveTabId(frame.tab.id)
          }
          else if (frame.type === 'closed') {
            setBrowserTabs(prev => prev.filter(t => t.id !== frame.id))
            if (activeTabId === frame.id) {
              setActiveTabId(terminals[0]?.terminalId || '')
            }
          }
          break
        }
        case 'terminal': {
          if (frame.type === 'terminals') {
            setTerminals(frame.terminals)
            if (frame.terminals.length > 0 && (!activeTabId || activeTabId === 'terminal')) {
              setActiveTabId(frame.terminals[0].terminalId)
            }
          }
          else if (frame.type === 'opened') {
            setTerminals(prev => {
              if (prev.some(t => t.terminalId === frame.view.terminalId)) return prev
              return [...prev, frame.view]
            })
            setActiveTabId(frame.view.terminalId)
          }
          else if (frame.type === 'activity') {
            const list = activityLog.current.get(frame.id) ?? []
            list.push(frame.entry)
            if (list.length > 200) list.shift()
            activityLog.current.set(frame.id, list)
            setActivityVersion(v => v + 1)
          }
          else if (frame.type === 'closed') {
            if (activeTabId === frame.id) {
              const remaining = terminals.filter(t => t.terminalId !== frame.id)
              setActiveTabId(remaining[0]?.terminalId || (browserTabs[0]?.id ?? ''))
            }
          }
          break
        }
        case 'error': {
          setGlobalError(frame.message)
          break
        }
      }
    })

    const disposeState = workbenchClient.onState(setConnected)
    return () => {
      disposeFrames()
      disposeState()
    }
  }, [sessionId, activeTabId, terminals, browserTabs])

  const activityFeed = useMemo(() => {
    void activityVersion
    const all: (ActivityEntry & { id: string })[] = []
    for (const [id, entries] of activityLog.current) {
      for (const entry of entries) all.push({ ...entry, id })
    }
    return all.sort((a, b) => b.at - a.at)
  }, [activityVersion])

  // Escape dismisses the new-tab menu
  useEffect(() => {
    if (!plusMenuOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPlusMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plusMenuOpen])

  const handleClose = () => {
    if (closeDetails) closeDetails()
    closeSidebarColumn()
  }

  const handleToggleMaximize = () => {
    setMaximized(toggleMaximize())
  }

  const handleCreateTerminal = () => {
    setPlusMenuOpen(false)
    workbenchClient.send({
      channel: 'terminal',
      type: 'open',
      request: { kind: 'local', name: `终端 ${terminals.length + 1}`, sessionId, echo: true },
    })
  }

  const handleCreateBrowser = () => {
    setPlusMenuOpen(false)
    workbenchClient.send({
      channel: 'browser',
      type: 'open',
      url: 'about:blank',
      title: '新标签页',
      sessionId,
    })
  }

  const activeBrowser = useMemo(
    () => browserTabs.find(t => t.id === activeTabId),
    [browserTabs, activeTabId],
  )
  const activeTerminal = useMemo(
    () => terminals.find(t => t.terminalId === activeTabId),
    [terminals, activeTabId],
  )

  const resizeHandleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (resizeHandleRef.current) {
      return initResizeHandle(resizeHandleRef.current)
    }
  }, [])

  return (
    <div className="wb-sidebar-root">
      {/* 分屏宽度拖拽手柄（宽感应带，双击恢复 48vw 默认半屏） */}
      <div className="wb-resize-handle" ref={resizeHandleRef} title="拖拽调整分屏宽度 · 双击复位 48%" />

      <div className="wb-panel-card">
      {/* 统一的一级标签栏：品牌区 + 终端 / 网页 / Git / 动态 平级铺开 */}
      <div className="wb-sidebar-header">
        <div className="wb-brand">
          <span className="wb-brand-mark"><TerminalIcon size={12} /></span>
          <span className="wb-brand-name">工作台</span>
        </div>
        <div className="wb-unified-tabstrip">
          {terminals.map(t => (
            <button
              key={t.terminalId}
              type="button"
              className={`wb-unified-tab wb-tab-term${activeTabId === t.terminalId ? ' active' : ''}`}
              onClick={() => setActiveTabId(t.terminalId)}
              title={t.kind === 'ssh' ? `${t.user}@${t.host}:${t.port}` : (t.cwd || '本地项目目录')}
            >
              <TerminalIcon size={12} className="wb-tab-icon" />
              <span className="wb-tab-label">{t.name ?? '本地终端'}</span>
              {t.unreadBytes > 0 && activeTabId !== t.terminalId ? <span className="wb-unread-dot" /> : null}
              {terminals.length > 1 ? (
                <span
                  className="wb-tab-close-btn"
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    workbenchClient.send({ channel: 'terminal', type: 'close', id: t.terminalId })
                  }}
                >
                  <CloseIcon size={10} />
                </span>
              ) : null}
            </button>
          ))}

          {browserTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`wb-unified-tab wb-tab-web${activeTabId === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
              title={tab.url}
            >
              <GlobeIcon size={12} className="wb-tab-icon" />
              <span className="wb-tab-label">{tab.title}</span>
              <span
                className="wb-tab-close-btn"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  workbenchClient.send({ channel: 'browser', type: 'close', id: tab.id })
                }}
              >
                <CloseIcon size={10} />
              </span>
            </button>
          ))}

          {gitTabOpen ? (
            <button
              type="button"
              className={`wb-unified-tab wb-tab-git${activeTabId === 'git' ? ' active' : ''}`}
              onClick={() => setActiveTabId('git')}
            >
              <GitBranchIcon size={12} className="wb-tab-icon" />
              <span className="wb-tab-label">Git</span>
              <span
                className="wb-tab-close-btn"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  setGitTabOpen(false)
                  if (activeTabId === 'git') setActiveTabId(terminals[0]?.terminalId || '')
                }}
              >
                <CloseIcon size={10} />
              </span>
            </button>
          ) : null}

          {activityTabOpen ? (
            <button
              type="button"
              className={`wb-unified-tab wb-tab-activity${activeTabId === 'activity' ? ' active' : ''}`}
              onClick={() => setActiveTabId('activity')}
            >
              <ActivityIcon size={12} className="wb-tab-icon" />
              <span className="wb-tab-label">动态</span>
              <span className="wb-tab-count">{activityFeed.length}</span>
              <span
                className="wb-tab-close-btn"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  setActivityTabOpen(false)
                  if (activeTabId === 'activity') setActiveTabId(terminals[0]?.terminalId || '')
                }}
              >
                <CloseIcon size={10} />
              </span>
            </button>
          ) : null}

          {/* 新建标签按钮与浮动菜单 */}
          <div className="wb-plus-wrapper">
            <button
              type="button"
              className={`wb-plus-btn${plusMenuOpen ? ' active' : ''}`}
              onClick={() => setPlusMenuOpen(!plusMenuOpen)}
              title="新建标签"
            >
              <PlusIcon size={13} />
            </button>

            {plusMenuOpen ? (
              <div className="wb-plus-menu">
                <button type="button" className="wb-menu-item" onClick={handleCreateTerminal}>
                  <span className="wb-menu-icon"><TerminalIcon size={13} /></span>
                  <span>新建本地终端</span>
                </button>
                <button type="button" className="wb-menu-item" onClick={handleCreateBrowser}>
                  <span className="wb-menu-icon"><GlobeIcon size={13} /></span>
                  <span>新建网页标签</span>
                </button>
                {!gitTabOpen || !activityTabOpen ? <div className="wb-menu-sep" /> : null}
                {!gitTabOpen ? (
                  <button
                    type="button"
                    className="wb-menu-item"
                    onClick={() => {
                      setGitTabOpen(true)
                      setActiveTabId('git')
                      setPlusMenuOpen(false)
                    }}
                  >
                    <span className="wb-menu-icon"><GitBranchIcon size={13} /></span>
                    <span>打开 Git 面板</span>
                  </button>
                ) : null}
                {!activityTabOpen ? (
                  <button
                    type="button"
                    className="wb-menu-item"
                    onClick={() => {
                      setActivityTabOpen(true)
                      setActiveTabId('activity')
                      setPlusMenuOpen(false)
                    }}
                  >
                    <span className="wb-menu-icon"><ActivityIcon size={13} /></span>
                    <span>查看协同动态流</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 窗口级操作 */}
        <div className="wb-window-actions">
          <span className={`wb-dot ${connected ? 'ok' : 'dead'}`} title={connected ? '协同网关已连接' : '网关离线重连中'} />
          <button
            type="button"
            className="wb-icon-btn"
            onClick={handleToggleMaximize}
            title={maximized ? '恢复分屏' : '全屏展开工作台'}
          >
            <MaximizeIcon size={13} />
          </button>
          <button
            type="button"
            className="wb-icon-btn"
            onClick={handleClose}
            title="收起工作台"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      {globalError ? (
        <div className="wb-alert-banner">
          <span>{globalError}</span>
          <button type="button" onClick={() => setGlobalError(undefined)} title="关闭提示"><CloseIcon size={12} /></button>
        </div>
      ) : null}

      {/* 主工作区视口：100% 完整展现选中的模式，零嵌套子标签 */}
      <div className="wb-sidebar-body" onClick={() => plusMenuOpen && setPlusMenuOpen(false)}>
        {activeTerminal && (
          <TerminalView
            activeTerminalId={activeTerminal.terminalId}
            onError={msg => setGlobalError(msg)}
          />
        )}

        {activeBrowser && (
          <BrowserView
            tab={activeBrowser}
            onNavigate={(newUrl) => {
              setBrowserTabs(prev => prev.map(t => t.id === activeBrowser.id ? { ...t, url: newUrl } : t))
            }}
          />
        )}

        {activeTabId === 'git' && (
          <div className="wb-empty-feed" style={{ marginTop: 90 }}>
            <GitBranchIcon size={28} className="wb-empty-icon" />
            <p className="wb-empty-title">Git 协同面板</p>
            <p className="wb-hint">更改列表、分支视图与人机协同提交，将在后续版本加入。</p>
          </div>
        )}

        {activeTabId === 'activity' && (
          <div className="wb-activity-container">
            <ActivityFeed feed={activityFeed} terminals={terminals} />
          </div>
        )}
      </div>

      {/* 底部状态栏：随激活标签自适应，右侧常驻协同同步状态 */}
      <div className="wb-status-bar">
        <div className="wb-status-left">
          {activeTerminal ? (
            <>
              <span className={`wb-status-dot ${activeTerminal.status.kind === 'running' ? 'ok' : 'exited'}`} />
              <span className="wb-status-item wb-status-strong">
                <span className="wb-status-icon">
                  {activeTerminal.kind === 'ssh' ? <ServerIcon size={11} /> : <TerminalIcon size={11} />}
                </span>
                {activeTerminal.kind === 'ssh' ? `${activeTerminal.user ?? ''}@${activeTerminal.host ?? ''}` : 'Git Bash'}
              </span>
              <span className="wb-status-sep" />
              <span className="wb-status-path" title={activeTerminal.cwd}>{activeTerminal.cwd || '~'}</span>
            </>
          ) : activeBrowser ? (
            <>
              <span className="wb-status-item wb-status-strong">
                <span className="wb-status-icon"><GlobeIcon size={11} /></span>
                浏览器预览
              </span>
              <span className="wb-status-sep" />
              <span className="wb-status-path" title={activeBrowser.url}>{activeBrowser.url}</span>
            </>
          ) : activeTabId === 'git' ? (
            <>
              <span className="wb-status-item wb-status-strong">
                <span className="wb-status-icon"><GitBranchIcon size={11} /></span>
                Git 协同
              </span>
              <span className="wb-status-sep" />
              <span className="wb-status-path">分支与变更视图 · 预览版</span>
            </>
          ) : activeTabId === 'activity' ? (
            <>
              <span className="wb-status-item wb-status-strong">
                <span className="wb-status-icon"><ActivityIcon size={11} /></span>
                协同动态
              </span>
              <span className="wb-status-sep" />
              <span className="wb-status-path">{activityFeed.length} 条操作记录</span>
            </>
          ) : (
            <span className="wb-status-item">就绪</span>
          )}
        </div>
        <div className="wb-status-right">
          {activeTerminal ? (
            <>
              <span className="wb-status-item wb-status-size">{activeTerminal.cols}×{activeTerminal.rows}</span>
              <span className="wb-status-sep" />
            </>
          ) : null}
          <span className={`wb-status-item ${connected ? 'wb-status-sync-ok' : 'wb-status-sync-warn'}`}>
            <span className={`wb-status-dot ${connected ? 'ok' : 'dead'}`} />
            {connected ? '协同已同步' : '网关重连中'}
          </span>
        </div>
      </div>
      </div>
    </div>
  )
}
