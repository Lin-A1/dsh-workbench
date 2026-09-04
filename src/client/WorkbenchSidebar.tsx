/**
 * Collaborative Workspace Studio Component.
 * Unified single-tier Tab Strip with true 50% split width, full maximization,
 * zero emoji, and seamless Browser / Terminal / Git multi-tasking.
 * @module dsh-workbench/client/WorkbenchSidebar
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import type { WorkbenchBrowserTab } from '../protocol.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { BrowserView } from './browser/BrowserView.tsx'
import { closeSidebarColumn, toggleMaximize } from './column.ts'
import { ActivityIcon, CloseIcon, GitBranchIcon, GlobeIcon, MaximizeIcon, PlusIcon, TerminalIcon } from './icons.tsx'
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

  const handleClose = () => {
    if (closeDetails) closeDetails()
    closeSidebarColumn()
  }

  const handleToggleMaximize = () => {
    const isMax = toggleMaximize()
    setMaximized(isMax)
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
      url: 'http://localhost:3000',
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

  return (
    <div className="wb-sidebar-root">
      {/* 统一的一级标签栏 (Unified Tab Strip - 对标截图) */}
      <div className="wb-sidebar-header">
        <div className="wb-unified-tabstrip">
          {/* 终端会话标签列表 */}
          {terminals.map(t => (
            <button
              key={t.terminalId}
              type="button"
              className={`wb-unified-tab${activeTabId === t.terminalId ? ' active' : ''}`}
              onClick={() => {
                setActiveTabId(t.terminalId)
              }}
              title={t.kind === 'ssh' ? `${t.user}@${t.host}:${t.port}` : (t.cwd || '本地项目目录')}
            >
              <TerminalIcon size={12} className="wb-tab-icon" />
              <span className="wb-tab-label">{t.name ?? '本地终端'}</span>
              {t.unreadBytes > 0 ? <span className="wb-unread-dot" /> : null}
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

          {/* 浏览器网页标签列表 (如同截图中的 newhorse, DeskAware v2.1) */}
          {browserTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`wb-unified-tab${activeTabId === tab.id ? ' active' : ''}`}
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

          {/* Git 标签 */}
          {gitTabOpen ? (
            <button
              type="button"
              className={`wb-unified-tab${activeTabId === 'git' ? ' active' : ''}`}
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

          {/* 动态流标签 */}
          {activityTabOpen ? (
            <button
              type="button"
              className={`wb-unified-tab${activeTabId === 'activity' ? ' active' : ''}`}
              onClick={() => setActiveTabId('activity')}
            >
              <ActivityIcon size={12} className="wb-tab-icon" />
              <span className="wb-tab-label">动态 ({activityFeed.length})</span>
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

          {/* 新建标签按钮 (+) 及轻量下拉菜单 */}
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
                <button type="button" onClick={handleCreateTerminal}>
                  <TerminalIcon size={12} />
                  <span>新建本地终端</span>
                </button>
                <button type="button" onClick={handleCreateBrowser}>
                  <GlobeIcon size={12} />
                  <span>新建网页标签</span>
                </button>
                {!gitTabOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setGitTabOpen(true)
                      setActiveTabId('git')
                      setPlusMenuOpen(false)
                    }}
                  >
                    <GitBranchIcon size={12} />
                    <span>打开 Git 面板</span>
                  </button>
                ) : null}
                {!activityTabOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActivityTabOpen(true)
                      setActiveTabId('activity')
                      setPlusMenuOpen(false)
                    }}
                  >
                    <ActivityIcon size={12} />
                    <span>查看协同动态流</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 窗口级别操作按钮 */}
        <div className="wb-window-actions">
          <span className={`wb-dot ${connected ? 'ok' : 'dead'}`} title={connected ? '协同网关已连接' : '网关离线重连中'} />
          <button
            type="button"
            className="wb-action-btn"
            onClick={handleToggleMaximize}
            title={maximized ? '恢复分屏' : '全屏展开工作台'}
          >
            <MaximizeIcon size={13} />
          </button>
          <button
            type="button"
            className="wb-action-btn"
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
          <button type="button" onClick={() => setGlobalError(undefined)}><CloseIcon size={12} /></button>
        </div>
      ) : null}

      {/* 主工作区视口 (100% 完整展现选中的模式) */}
      <div className="wb-sidebar-body" onClick={() => plusMenuOpen && setPlusMenuOpen(false)}>
        {/* 当激活终端时：渲染全屏终端视口，内部零子Tab套娃！ */}
        {activeTerminal && (
          <TerminalView
            activeTerminalId={activeTerminal.terminalId}
            onError={msg => setGlobalError(msg)}
          />
        )}

        {/* 当激活网页时：渲染全屏浏览器视口 (对标截图地址栏+网页渲染) */}
        {activeBrowser && (
          <BrowserView
            tab={activeBrowser}
            onNavigate={(newUrl) => {
              setBrowserTabs(prev => prev.map(t => t.id === activeBrowser.id ? { ...t, url: newUrl } : t))
            }}
          />
        )}

        {/* Git 面板 */}
        {activeTabId === 'git' && (
          <div className="wb-feature-card">
            <div className="wb-card-inner">
              <div className="wb-icon-circle">
                <GitBranchIcon size={24} />
              </div>
              <h4>Git 协同管理 (Phase 2)</h4>
              <p>未暂存/已暂存文件树、双栏 Diff 对比、人机协同 Commit 与分支检出。</p>
              <div className="wb-feature-tags">
                <code>status</code>
                <code>diff</code>
                <code>stage</code>
                <code>commit</code>
              </div>
            </div>
          </div>
        )}

        {/* 动态流 */}
        {activeTabId === 'activity' && (
          <div className="wb-activity-container">
            <ActivityFeed feed={activityFeed} terminals={terminals} />
          </div>
        )}
      </div>
    </div>
  )
}
