/**
 * Main Collaborative Workbench View component (attached to conversation).
 * @module dsh-workbench/client/Workbench
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import type { TerminalProfile } from '../protocol.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { TerminalView } from './terminal/TerminalView.tsx'
import { workbenchClient } from './ws.ts'

export type WorkbenchTab = 'terminal' | 'git' | 'browser' | 'activity'

export interface WorkbenchProps {
  sessionId?: string
}

export function Workbench({ sessionId }: WorkbenchProps): JSX.Element {
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

  return (
    <div className="dsh-wb-root" data-conversation-composer-overlay="">
      {/* 顶部一级导航条 */}
      <div className="dsh-wb-header">
        <div className="dsh-wb-brand">
          <span className="dsh-wb-logo">⚡</span>
          <span className="dsh-wb-title">协同工作台</span>
          {sessionId ? <span className="dsh-wb-session-chip">会话: {sessionId.slice(0, 16)}…</span> : null}
        </div>

        <div className="dsh-wb-nav">
          <button
            type="button"
            className={`dsh-wb-nav-item${activeTab === 'terminal' ? ' active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            <span>💻 终端</span>
            {terminals.some(t => t.unreadBytes > 0) ? <span className="dsh-wb-unread-dot" /> : null}
          </button>
          <button
            type="button"
            className={`dsh-wb-nav-item${activeTab === 'git' ? ' active' : ''}`}
            onClick={() => setActiveTab('git')}
          >
            <span>🌿 Git 管理</span>
          </button>
          <button
            type="button"
            className={`dsh-wb-nav-item${activeTab === 'browser' ? ' active' : ''}`}
            onClick={() => setActiveTab('browser')}
          >
            <span>🌐 共同浏览器</span>
          </button>
          <button
            type="button"
            className={`dsh-wb-nav-item${activeTab === 'activity' ? ' active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            <span>📋 活动流 ({activityFeed.length})</span>
          </button>
        </div>

        <div className="dsh-wb-status-badge">
          <span className={`wb-dot ${connected ? 'ok' : 'dead'}`} />
          <span>{connected ? '协同网关在线' : '离线重连中…'}</span>
        </div>
      </div>

      {globalError ? (
        <div className="dsh-wb-alert">
          <span>{globalError}</span>
          <button type="button" onClick={() => setGlobalError(undefined)}>×</button>
        </div>
      ) : null}

      {/* 主工作台视图区域 */}
      <div className="dsh-wb-main">
        {activeTab === 'terminal' && (
          <TerminalView
            terminals={terminals}
            profiles={profiles}
            sessionId={sessionId}
            onError={msg => setGlobalError(msg)}
          />
        )}

        {activeTab === 'git' && (
          <div className="dsh-wb-placeholder">
            <div className="dsh-wb-placeholder-card">
              <span className="dsh-wb-placeholder-icon">🌿</span>
              <h3>Git 协同版本管理面板 (Phase 2)</h3>
              <p>即将在第二阶段推出：提供未暂存/已暂存文件树、变更对比 (Diff) 视图、人机协同 Commit 与分支切换。</p>
              <div className="dsh-wb-tags">
                <span>git status</span>
                <span>git diff</span>
                <span>stage / unstage</span>
                <span>协同 commit 归属</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'browser' && (
          <div className="dsh-wb-placeholder">
            <div className="dsh-wb-placeholder-card">
              <span className="dsh-wb-placeholder-icon">🌐</span>
              <h3>共同浏览器与 WebGUI 联动 (Phase 3)</h3>
              <p>即将在第三阶段推出：支持在工作区内嵌入实时受控浏览器页面，人类可实时查看 AI 浏览网页轨迹，或直接手动点击接管交互。</p>
              <div className="dsh-wb-tags">
                <span>实时画面投影</span>
                <span>人机协同交互</span>
                <span>DOM 树检测</span>
                <span>页面快照归档</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="dsh-wb-activity-wrapper">
            <ActivityFeed feed={activityFeed} terminals={terminals} />
          </div>
        )}
      </div>
    </div>
  )
}
