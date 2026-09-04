/**
 * Collaborative Workspace Studio Component.
 * High-fidelity side-by-side workspace panel: In-App Browser preview,
 * multi-tab terminal, Git management, and live activity streams.
 * Matches modern AI IDE workbench UX standards with zero emoji.
 * @module dsh-workbench/client/WorkbenchSidebar
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import type { TerminalProfile, WorkbenchBrowserTab } from '../protocol.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { BrowserView } from './browser/BrowserView.tsx'
import { closeSidebarColumn } from './column.ts'
import { ActivityIcon, CloseIcon, GitBranchIcon, GlobeIcon, MaximizeIcon, PlusIcon, TerminalIcon } from './icons.tsx'
import { TerminalView } from './terminal/TerminalView.tsx'
import { workbenchClient } from './ws.ts'

export interface WorkbenchSidebarProps {
  sessionId?: string
  closeDetails?: () => void
}

export function WorkbenchSidebar({ sessionId, closeDetails }: WorkbenchSidebarProps): JSX.Element {
  const [activeTabId, setActiveTabId] = useState<string>('terminal')
  const [terminals, setTerminals] = useState<TerminalCollaborationView[]>([])
  const [profiles, setProfiles] = useState<TerminalProfile[]>([])
  const [browserTabs, setBrowserTabs] = useState<WorkbenchBrowserTab[]>([])
  const [connected, setConnected] = useState(false)
  const [globalError, setGlobalError] = useState<string | undefined>(undefined)
  const [activityVersion, setActivityVersion] = useState(0)
  const [isMaximized, setIsMaximized] = useState(false)

  const activityLog = useRef(new Map<string, ActivityEntry[]>())

  useEffect(() => {
    workbenchClient.setSessionId(sessionId)
    workbenchClient.start()

    const disposeFrames = workbenchClient.onFrame((frame) => {
      switch (frame.channel) {
        case 'workbench': {
          if (frame.type === 'hello') {
            setTerminals(frame.terminals)
            setProfiles(frame.profiles)
            if (frame.browserTabs) setBrowserTabs(frame.browserTabs)
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
            if (activeTabId === frame.id) setActiveTabId('terminal')
          }
          break
        }
        case 'terminal': {
          if (frame.type === 'terminals') {
            setTerminals(frame.terminals)
          }
          else if (frame.type === 'profiles') {
            setProfiles(frame.profiles)
          }
          else if (frame.type === 'activity') {
            const list = activityLog.current.get(frame.id) ?? []
            list.push(frame.entry)
            if (list.length > 200) list.shift()
            activityLog.current.set(frame.id, list)
            setActivityVersion(v => v + 1)
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
  }, [sessionId, activeTabId])

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

  const handleCreateNewTab = () => {
    // Open a fresh browser tab with a blank/default page
    workbenchClient.send({
      channel: 'browser',
      type: 'open',
      url: 'http://localhost:3000',
      title: '新标签页',
      sessionId,
    })
  }

  const activeBrowserTab = useMemo(
    () => browserTabs.find(t => t.id === activeTabId),
    [browserTabs, activeTabId],
  )

  return (
    <div className={`wb-sidebar-root${isMaximized ? ' maximized' : ''}`}>
      {/* 顶层现代化多模式标签栏 (Tab Strip) - 对标截图水准 */}
      <div className="wb-sidebar-header">
        <div className="wb-sidebar-tabs">
          {/* 终端主标签 */}
          <button
            type="button"
            className={`wb-tab-btn${activeTabId === 'terminal' ? ' active' : ''}`}
            onClick={() => setActiveTabId('terminal')}
            title="协同终端"
          >
            <TerminalIcon size={12} />
            <span>终端</span>
            {terminals.some(t => t.unreadBytes > 0) ? <span className="wb-badge-dot" /> : null}
          </button>

          {/* 浏览器网页标签列表 (如同截图中的 newhorse, DeskAware v2.1) */}
          {browserTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`wb-tab-btn${activeTabId === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
              title={tab.url}
            >
              <GlobeIcon size={12} />
              <span className="wb-tab-title">{tab.title}</span>
              <span
                className="wb-tab-close-icon"
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
          <button
            type="button"
            className={`wb-tab-btn${activeTabId === 'git' ? ' active' : ''}`}
            onClick={() => setActiveTabId('git')}
            title="Git 版本管理"
          >
            <GitBranchIcon size={12} />
            <span>Git</span>
          </button>

          {/* 动态流标签 */}
          <button
            type="button"
            className={`wb-tab-btn${activeTabId === 'activity' ? ' active' : ''}`}
            onClick={() => setActiveTabId('activity')}
            title="协同动态流"
          >
            <ActivityIcon size={12} />
            <span>动态</span>
            {activityFeed.length > 0 ? <span className="wb-tab-count">{activityFeed.length}</span> : null}
          </button>

          {/* 新建标签 + 按钮 */}
          <button
            type="button"
            className="wb-tab-btn wb-tab-add"
            onClick={handleCreateNewTab}
            title="新建浏览器网页标签"
          >
            <PlusIcon size={13} />
          </button>
        </div>

        {/* 窗口级别操作按钮 */}
        <div className="wb-header-actions">
          <span className={`wb-dot ${connected ? 'ok' : 'dead'}`} title={connected ? '协同网关已连接' : '网关离线重连中'} />
          <button
            type="button"
            className="wb-action-icon-btn"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? '恢复分屏宽度' : '全宽展开工作台'}
          >
            <MaximizeIcon size={13} />
          </button>
          <button
            type="button"
            className="wb-action-icon-btn"
            onClick={handleClose}
            title="收起工作台侧栏"
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

      {/* 视口区域 */}
      <div className="wb-sidebar-body">
        {activeTabId === 'terminal' && (
          <TerminalView
            terminals={terminals}
            profiles={profiles}
            sessionId={sessionId}
            onError={msg => setGlobalError(msg)}
          />
        )}

        {activeBrowserTab && (
          <BrowserView
            tab={activeBrowserTab}
            onNavigate={(newUrl) => {
              setBrowserTabs(prev => prev.map(t => t.id === activeBrowserTab.id ? { ...t, url: newUrl } : t))
            }}
          />
        )}

        {activeTabId === 'git' && (
          <div className="wb-feature-card">
            <div className="wb-card-inner">
              <div className="wb-icon-circle">
                <GitBranchIcon size={24} />
              </div>
              <h4>Git 协同管理 (Phase 2)</h4>
              <p>即将上线：未暂存/已暂存变更树、双栏 Diff 比较、人机协同 Commit 与分支签出。</p>
              <div className="wb-feature-tags">
                <code>status</code>
                <code>diff</code>
                <code>stage</code>
                <code>commit</code>
              </div>
            </div>
          </div>
        )}

        {activeTabId === 'activity' && (
          <div className="wb-activity-container">
            <ActivityFeed feed={activityFeed} terminals={terminals} />
          </div>
        )}
      </div>
    </div>
  )
}
