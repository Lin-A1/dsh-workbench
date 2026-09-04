/**
 * Collaborative Workbench Sidebar Component.
 * Embedded inside the right-hand details column next to the conversation.
 * @module dsh-workbench/client/WorkbenchSidebar
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import type { TerminalProfile } from '../protocol.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { closeSidebarColumn } from './column.ts'
import { ActivityIcon, CloseIcon, GitBranchIcon, GlobeIcon, TerminalIcon } from './icons.tsx'
import { TerminalView } from './terminal/TerminalView.tsx'
import { workbenchClient } from './ws.ts'

export type WorkbenchTab = 'terminal' | 'git' | 'browser' | 'activity'

export interface WorkbenchSidebarProps {
  sessionId?: string
  closeDetails?: () => void
}

export function WorkbenchSidebar({ sessionId, closeDetails }: WorkbenchSidebarProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('terminal')
  const [terminals, setTerminals] = useState<TerminalCollaborationView[]>([])
  const [profiles, setProfiles] = useState<TerminalProfile[]>([])
  const [connected, setConnected] = useState(false)
  const [globalError, setGlobalError] = useState<string | undefined>(undefined)
  const [activityVersion, setActivityVersion] = useState(0)

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
  }, [sessionId])

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

  return (
    <div className="wb-sidebar-root">
      {/* 顶部主导航工具栏 */}
      <div className="wb-sidebar-header">
        <div className="wb-sidebar-tabs">
          <button
            type="button"
            className={`wb-tab-btn${activeTab === 'terminal' ? ' active' : ''}`}
            onClick={() => setActiveTab('terminal')}
            title="终端协同"
          >
            <TerminalIcon size={13} />
            <span>终端</span>
            {terminals.some(t => t.unreadBytes > 0) ? <span className="wb-badge-dot" /> : null}
          </button>

          <button
            type="button"
            className={`wb-tab-btn${activeTab === 'git' ? ' active' : ''}`}
            onClick={() => setActiveTab('git')}
            title="Git 版本管理"
          >
            <GitBranchIcon size={13} />
            <span>Git</span>
          </button>

          <button
            type="button"
            className={`wb-tab-btn${activeTab === 'browser' ? ' active' : ''}`}
            onClick={() => setActiveTab('browser')}
            title="共同浏览器"
          >
            <GlobeIcon size={13} />
            <span>浏览器</span>
          </button>

          <button
            type="button"
            className={`wb-tab-btn${activeTab === 'activity' ? ' active' : ''}`}
            onClick={() => setActiveTab('activity')}
            title="协同动态流"
          >
            <ActivityIcon size={13} />
            <span>动态</span>
            {activityFeed.length > 0 ? <span className="wb-tab-count">{activityFeed.length}</span> : null}
          </button>
        </div>

        <div className="wb-header-actions">
          <span className={`wb-dot ${connected ? 'ok' : 'dead'}`} title={connected ? '网关已连接' : '网关离线重连中'} />
          <button type="button" className="wb-close-btn" onClick={handleClose} title="收起工作台侧栏">
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

      {/* 视图主体 */}
      <div className="wb-sidebar-body">
        {activeTab === 'terminal' && (
          <TerminalView
            terminals={terminals}
            profiles={profiles}
            sessionId={sessionId}
            onError={msg => setGlobalError(msg)}
          />
        )}

        {activeTab === 'git' && (
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

        {activeTab === 'browser' && (
          <div className="wb-feature-card">
            <div className="wb-card-inner">
              <div className="wb-icon-circle">
                <GlobeIcon size={24} />
              </div>
              <h4>共同浏览器 (Phase 3)</h4>
              <p>即将上线：受控浏览器实时视口、人机同步浏览与 DOM 交互接管。</p>
              <div className="wb-feature-tags">
                <code>live view</code>
                <code>devtools</code>
                <code>screencast</code>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="wb-activity-container">
            <ActivityFeed feed={activityFeed} terminals={terminals} />
          </div>
        )}
      </div>
    </div>
  )
}
