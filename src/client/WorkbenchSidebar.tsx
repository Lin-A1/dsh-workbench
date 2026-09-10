/**
 * Collaborative Workspace Studio component.
 *
 * One flat tab strip for every panel kind (terminal / page / git / activity),
 * so the panel body is pure viewport with no nested tab bars. The new-tab menu
 * is positioned in the panel ROOT rather than inside the header: the header
 * strip scrolls (`overflow-x`) and the card clips (`overflow: hidden`), either
 * of which silently swallows an absolutely-positioned dropdown — the menu was
 * rendering off-screen and the "+" button looked dead.
 * @module dsh-workbench/client/WorkbenchSidebar
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import type { WorkbenchBrowserTab } from '../protocol.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { BrowserView, DEFAULT_HOME_URL } from './browser/BrowserView.tsx'
import { openWorkbench } from './column.ts'
import { GitPanel } from './GitPanel.tsx'
import { ActivityIcon, CloseIcon, GitBranchIcon, GlobeIcon, PlusIcon, ServerIcon, TerminalIcon } from './icons.tsx'
import { TerminalView } from './terminal/TerminalView.tsx'
import { workbenchClient } from './ws.ts'

export interface WorkbenchSidebarProps {
  sessionId?: string
}

/**
 * Rendered width of the new-tab menu. A measured constant, not the CSS
 * `min-width`: the two differ by the box's padding and border, and anchoring on
 * the smaller number hung the menu 4px past the panel's edge.
 */
const PLUS_MENU_WIDTH = 226

interface TabShellProps {
  active: boolean
  label: string
  title: string
  icon: JSX.Element
  badge?: JSX.Element | null
  onSelect: () => void
  onClose?: () => void
}

/**
 * One tab: a shell that owns the pill background plus two real sibling
 * buttons. Nesting the close control inside the tab button (the previous
 * shape) puts interactive content inside interactive content, which browsers
 * and assistive tech resolve inconsistently.
 */
function TabShell({ active, label, title, icon, badge, onSelect, onClose }: TabShellProps): JSX.Element {
  return (
    <div className={`wb-tab-shell${active ? ' active' : ''}`}>
      <button type="button" className="wb-tab-main" onClick={onSelect} title={title}>
        <span className="wb-tab-icon">{icon}</span>
        <span className="wb-tab-label">{label}</span>
        {badge}
      </button>
      {onClose === undefined ? null : (
        <button type="button" className="wb-tab-close-btn" onClick={onClose} title="关闭标签">
          <CloseIcon size={10} />
        </button>
      )}
    </div>
  )
}

/**
 * A short chip title for an address the human navigated to. The hostname is
 * what identifies a page at a glance in a narrow column; a local path shows its
 * last segment, because its "hostname" is empty.
 */
function titleForUrl(raw: string): string {
  if (!raw || raw === 'about:blank') return '新标签页'
  try {
    const url = new URL(raw)
    if (url.protocol === 'file:') {
      const segments = url.pathname.split('/').filter(Boolean)
      return decodeURIComponent(segments[segments.length - 1] ?? '') || '本地文档'
    }
    return url.hostname || raw.slice(0, 32)
  }
  catch {
    return raw.slice(0, 32)
  }
}

export function WorkbenchSidebar({ sessionId }: WorkbenchSidebarProps): JSX.Element {
  const [activeTabId, setActiveTabId] = useState('')
  const [terminals, setTerminals] = useState<TerminalCollaborationView[]>([])
  const [browserTabs, setBrowserTabs] = useState<WorkbenchBrowserTab[]>([])
  const [connected, setConnected] = useState(false)
  const [globalError, setGlobalError] = useState<string | undefined>(undefined)
  const [activityVersion, setActivityVersion] = useState(0)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [plusMenuAt, setPlusMenuAt] = useState({ left: 16, top: 52 })
  const [gitTabOpen, setGitTabOpen] = useState(false)
  const [activityTabOpen, setActivityTabOpen] = useState(false)

  const activityLog = useRef(new Map<string, ActivityEntry[]>())
  const ensuredSessionRef = useRef<string | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const plusBtnRef = useRef<HTMLButtonElement | null>(null)
  const plusMenuRef = useRef<HTMLDivElement | null>(null)

  // Live mirrors of the list state. The frame subscription reads these instead
  // of the React state, which lets it stay mounted for the whole session: the
  // previous version re-subscribed on every list change, and frames that
  // arrived during the swap window were dropped — opens and closes looked like
  // they did nothing.
  const terminalsRef = useRef<TerminalCollaborationView[]>([])
  const browserTabsRef = useRef<WorkbenchBrowserTab[]>([])
  const activeTabRef = useRef('')
  const chromeTabsRef = useRef({ git: false, activity: false })

  const selectTab = useCallback((id: string) => {
    activeTabRef.current = id
    setActiveTabId(id)
  }, [])

  const updateTerminals = useCallback((change: (list: TerminalCollaborationView[]) => TerminalCollaborationView[]) => {
    const next = change(terminalsRef.current)
    terminalsRef.current = next
    setTerminals(next)
  }, [])

  const applyBrowserTabs = useCallback((next: WorkbenchBrowserTab[]) => {
    browserTabsRef.current = next
    setBrowserTabs(next)
  }, [])

  const setChromeTab = useCallback((which: 'git' | 'activity', open: boolean) => {
    chromeTabsRef.current[which] = open
    if (which === 'git') setGitTabOpen(open)
    else setActivityTabOpen(open)
  }, [])

  /**
   * Re-point the active tab after a list change. A terminal can vanish under
   * the selection (closed by the model, or gone because the service restarted
   * and could not restore it) and a stale selection would leave the body blank
   * while still driving frames at a dead id.
   */
  const reconcileActiveTab = useCallback(() => {
    const { git, activity } = chromeTabsRef.current
    const available = [
      ...terminalsRef.current.map(t => t.terminalId),
      ...browserTabsRef.current.map(t => t.id),
      ...(git ? ['git'] : []),
      ...(activity ? ['activity'] : []),
    ]
    // Drop attribution history for terminals that are gone: the feed is keyed
    // by terminal id, so a closed tab would otherwise keep contributing rows
    // and inflate the tab badge forever.
    const live = new Set(available)
    let pruned = false
    for (const id of activityLog.current.keys()) {
      if (live.has(id)) continue
      activityLog.current.delete(id)
      pruned = true
    }
    if (pruned) setActivityVersion(v => v + 1)
    if (available.includes(activeTabRef.current)) return
    selectTab(available[0] ?? '')
  }, [selectTab])

  useEffect(() => {
    workbenchClient.setSessionId(sessionId)
    workbenchClient.start()
    // Attribution history belongs to the workspace, and the workspace changes
    // with the session: carrying another conversation's rows into this one
    // would attribute commands to terminals that are not even here.
    activityLog.current.clear()
    setActivityVersion(v => v + 1)
    // Re-ask on every mount/session change: the panel can be closed and
    // reopened, and a session switch changes what "the terminals" means.
    workbenchClient.send({ channel: 'workbench', type: 'hello', sessionId })
    if (sessionId !== undefined && ensuredSessionRef.current !== sessionId) {
      ensuredSessionRef.current = sessionId
      workbenchClient.send({ channel: 'terminal', type: 'ensure', sessionId })
    }

    const disposeFrames = workbenchClient.onFrame((frame) => {
      switch (frame.channel) {
        case 'workbench': {
          if (frame.type === 'hello') {
            // The gateway greets every socket before it knows a session, and
            // that unscoped greeting lists every session's terminals. Applying
            // it would flash other conversations' tabs here, so only a scoped
            // answer for THIS session is accepted.
            if (frame.sessionId !== sessionId) break
            updateTerminals(() => frame.terminals)
            applyBrowserTabs(frame.browserTabs ?? [])
            reconcileActiveTab()
          }
          else if (frame.type === 'summon') {
            // The model opened a terminal/browser tab (or called workbench_show):
            // reveal the panel so its actions are visible to the human.
            openWorkbench()
          }
          break
        }
        case 'browser': {
          if (frame.type === 'tabs') {
            applyBrowserTabs(frame.tabs)
            reconcileActiveTab()
          }
          else if (frame.type === 'opened') {
            applyBrowserTabs([...browserTabsRef.current.filter(t => t.id !== frame.tab.id), frame.tab])
            selectTab(frame.tab.id)
          }
          else if (frame.type === 'closed') {
            applyBrowserTabs(browserTabsRef.current.filter(t => t.id !== frame.id))
            reconcileActiveTab()
          }
          break
        }
        case 'terminal': {
          if (frame.type === 'terminals') {
            updateTerminals(() => frame.terminals)
            reconcileActiveTab()
          }
          else if (frame.type === 'opened') {
            updateTerminals(prev => [...prev.filter(t => t.terminalId !== frame.view.terminalId), frame.view])
            selectTab(frame.view.terminalId)
          }
          else if (frame.type === 'busy') {
            updateTerminals(prev => prev.map(t => t.terminalId === frame.id ? { ...t, busy: frame.busy, busyActor: frame.actor } : t))
          }
          else if (frame.type === 'attached') {
            // The attach frame carries the attribution history the server still
            // holds, which is what makes a reopened panel or a reconnected
            // socket show the work that is already in the scrollback.
            activityLog.current.set(frame.id, [...frame.activity])
            setActivityVersion(v => v + 1)
          }
          else if (frame.type === 'activity') {
            const list = activityLog.current.get(frame.id) ?? []
            list.push(frame.entry)
            if (list.length > 200) list.shift()
            activityLog.current.set(frame.id, list)
            setActivityVersion(v => v + 1)
          }
          else if (frame.type === 'closed') {
            updateTerminals(prev => prev.filter(t => t.terminalId !== frame.id))
            reconcileActiveTab()
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
  }, [sessionId, applyBrowserTabs, reconcileActiveTab, selectTab, updateTerminals])

  // The menu closes on an outside press and on Escape, so a stray click never
  // leaves it floating over the terminal.
  useEffect(() => {
    if (!plusMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (plusMenuRef.current?.contains(target) || plusBtnRef.current?.contains(target)) return
      setPlusMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPlusMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [plusMenuOpen])

  const activityFeed = useMemo(() => {
    void activityVersion
    const all: (ActivityEntry & { id: string })[] = []
    for (const [id, entries] of activityLog.current) {
      for (const entry of entries) all.push({ ...entry, id })
    }
    return all.sort((a, b) => b.at - a.at)
  }, [activityVersion])

  const openPlusMenu = useCallback(() => {
    const button = plusBtnRef.current
    const root = rootRef.current
    if (button && root) {
      const b = button.getBoundingClientRect()
      const r = root.getBoundingClientRect()
      // Right-align with the panel's inner edge rather than the button: the
      // window actions are the last row of the header, so the menu then sits
      // flush under them and can never overflow the column.
      const wanted = r.width - PLUS_MENU_WIDTH - 8
      setPlusMenuAt({
        left: Math.max(8, Math.min(wanted, r.width - 40)),
        top: b.bottom - r.top + 6,
      })
    }
    setPlusMenuOpen(true)
  }, [])

  const handleCreateTerminal = (): void => {
    setPlusMenuOpen(false)
    workbenchClient.send({
      channel: 'terminal',
      type: 'open',
      request: { kind: 'local', name: `终端 ${terminalsRef.current.length + 1}`, sessionId, echo: true },
    })
  }

  const handleCreateBrowser = (): void => {
    setPlusMenuOpen(false)
    // A real page, not an empty tab: "new browser tab" has to produce a browser.
    workbenchClient.send({
      channel: 'browser',
      type: 'open',
      url: DEFAULT_HOME_URL,
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
  const stageEmpty = activeTerminal === undefined && activeBrowser === undefined && activeTabId !== 'git' && activeTabId !== 'activity'

  return (
    <div className="wb-sidebar-root" ref={rootRef}>
      <div className="wb-panel-card">
        {/* One flat tab strip: brand, every terminal and page, then the tools */}
        <div className="wb-sidebar-header">
          <div className="wb-unified-tabstrip">
            {terminals.map(t => (
              <TabShell
                key={t.terminalId}
                active={activeTabId === t.terminalId}
                label={t.name ?? '本地终端'}
                title={t.kind === 'ssh' ? `${t.user}@${t.host}:${t.port}` : (t.cwd || '本地项目目录')}
                icon={<TerminalIcon size={12} />}
                badge={(
                  <>
                    {t.busy ? <span className="wb-busy-dot" title="AI 正在执行命令..." /> : null}
                    {t.unreadBytes > 0 && activeTabId !== t.terminalId && !t.busy ? <span className="wb-unread-dot" /> : null}
                  </>
                )}
                onSelect={() => selectTab(t.terminalId)}
                onClose={() => workbenchClient.send({ channel: 'terminal', type: 'close', id: t.terminalId })}
              />
            ))}

            {browserTabs.map(tab => (
              <TabShell
                key={tab.id}
                active={activeTabId === tab.id}
                label={tab.title}
                title={tab.url}
                icon={<GlobeIcon size={12} />}
                onSelect={() => selectTab(tab.id)}
                onClose={() => workbenchClient.send({ channel: 'browser', type: 'close', id: tab.id })}
              />
            ))}

            {gitTabOpen ? (
              <TabShell
                active={activeTabId === 'git'}
                label="Git"
                title="Git 协同面板"
                icon={<GitBranchIcon size={12} />}
                onSelect={() => selectTab('git')}
                onClose={() => {
                  setChromeTab('git', false)
                  reconcileActiveTab()
                }}
              />
            ) : null}

            {activityTabOpen ? (
              <TabShell
                active={activeTabId === 'activity'}
                label="动态"
                title="人机协同操作流"
                icon={<ActivityIcon size={12} />}
                badge={<span className="wb-tab-count">{activityFeed.length}</span>}
                onSelect={() => selectTab('activity')}
                onClose={() => {
                  setChromeTab('activity', false)
                  reconcileActiveTab()
                }}
              />
            ) : null}
          </div>

          {/* Window-level actions, outside the scrolling strip so nothing clips.
              The new-tab control is a labelled pill rather than a bare plus: the
              sidebar draws an add-tab plus of its own one row above, and the two
              mean different things (a new right-Sidebar tab type, versus a new
              terminal or page inside this one). Two identical glyphs a row apart
              read as one control with two behaviours. */}
          <div className="wb-window-actions">
            {/* The browser gets its own button. Behind the new-tab menu it read
                as "there is no way to open the browser", which is the wrong
                answer for the one surface people reach for most. */}
            <button
              type="button"
              className="wb-plus-btn"
              onClick={handleCreateBrowser}
              title="打开浏览器（在工作台内新建网页标签）"
            >
              <GlobeIcon size={12} />
              <span>网页</span>
            </button>
            <button
              type="button"
              className={`wb-plus-btn${plusMenuOpen ? ' active' : ''}`}
              ref={plusBtnRef}
              onClick={() => (plusMenuOpen ? setPlusMenuOpen(false) : openPlusMenu())}
              title="在工作台内新建终端，或打开 Git / 动态面板"
              aria-haspopup="menu"
              aria-expanded={plusMenuOpen}
            >
              <PlusIcon size={12} />
              <span>新建</span>
            </button>
            <span className={`wb-dot ${connected ? 'ok' : 'dead'}`} title={connected ? '协同网关已连接' : '网关离线重连中'} />
          </div>
        </div>

        {globalError ? (
          <div className="wb-alert-banner">
            <span>{globalError}</span>
            <button type="button" onClick={() => setGlobalError(undefined)} title="关闭提示"><CloseIcon size={12} /></button>
          </div>
        ) : null}

        {/* Main viewport: 100% of the body for the selected panel */}
        <div className="wb-sidebar-body">
          {activeTerminal ? (
            <TerminalView
              activeTerminalId={activeTerminal.terminalId}
              isBusy={activeTerminal.busy}
              onError={msg => setGlobalError(msg)}
            />
          ) : null}

          {activeBrowser ? (
            <BrowserView
              tab={activeBrowser}
              onNavigate={(newUrl) => {
                // The chip is the only place the human sees where this tab went,
                // so it follows the address instead of staying "新标签页" for the
                // rest of the session.
                applyBrowserTabs(browserTabsRef.current.map(t => t.id === activeBrowser.id
                  ? { ...t, url: newUrl, title: titleForUrl(newUrl) }
                  : t))
              }}
            />
          ) : null}

          {activeTabId === 'git' ? (
            <GitPanel sessionId={sessionId} active />
          ) : null}

          {activeTabId === 'activity' ? (
            <div className="wb-activity-container">
              <ActivityFeed feed={activityFeed} terminals={terminals} />
            </div>
          ) : null}

          {stageEmpty ? (
            <div className="wb-empty-stage">
              <span className="wb-empty-mark"><TerminalIcon size={20} /></span>
              <p className="wb-empty-title">这个会话还没有终端</p>
              <p className="wb-hint">终端、网页预览都开在这里；AI 也可以替你打开并实时共用。</p>
              <div className="wb-empty-actions">
                <button type="button" className="wb-empty-btn primary" onClick={handleCreateTerminal}>
                  <TerminalIcon size={12} />新建终端
                </button>
                <button type="button" className="wb-empty-btn" onClick={handleCreateBrowser}>
                  <GlobeIcon size={12} />新建网页
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Status bar: adapts to the active tab, sync state always on the right */}
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
                {activeTerminal.busy ? (
                  <>
                    <span className="wb-status-sep" />
                    <span className="wb-status-busy-pill">
                      <span className="wb-term-busy-pulse" />
                      AI 执行中
                    </span>
                  </>
                ) : null}
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
                <span className="wb-status-path">工作区变更与 Diff</span>
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
              <span className="wb-status-item">就绪 · 会话 {sessionId ? sessionId.slice(-6) : '未绑定'}</span>
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

      {/* The new-tab menu lives here, not in the header: this root does not
          clip, so the popover cannot be swallowed by the strip's overflow. */}
      {plusMenuOpen ? (
        <div
          className="wb-plus-menu"
          ref={plusMenuRef}
          role="menu"
          style={{ left: plusMenuAt.left, top: plusMenuAt.top }}
        >
          <button type="button" className="wb-menu-item" onClick={handleCreateTerminal}>
            <span className="wb-menu-icon"><TerminalIcon size={13} /></span>
            <span>新建本地终端</span>
          </button>
          {!gitTabOpen || !activityTabOpen ? <div className="wb-menu-sep" /> : null}
          {!gitTabOpen ? (
            <button
              type="button"
              className="wb-menu-item"
              onClick={() => {
                setChromeTab('git', true)
                selectTab('git')
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
                setChromeTab('activity', true)
                selectTab('activity')
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
  )
}
