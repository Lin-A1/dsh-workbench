/**
 * dsh-workbench browser half. Registers the collaborative workbench inside
 * the right-hand details column, with a toggle button in session utilities.
 * @module dsh-workbench/client
 */

import { createElement } from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { closeSidebarColumn, setLayoutFace } from './column.ts'
import { HeaderToggleAction } from './HeaderToggleAction.tsx'
import { workbenchClient } from './ws.ts'
import { WorkbenchSidebar } from './WorkbenchSidebar.tsx'

export const inject = ['slots', 'layout']

const WORKBENCH_SIDEBAR_CSS = `${xtermCss}
/* Force stable wide side-by-side grid when workbench is open (48vw half-screen width) */
body.wb-sidebar-opened [class*='detailsCol'] {
  display: block !important;
  width: min(780px, 48vw) !important;
  min-width: 480px !important;
  max-width: 960px !important;
  overflow: visible !important;
  flex: none !important;
}

body.wb-sidebar-opened [class*='frame'] {
  grid-template-columns: 260px minmax(0, 1fr) min(780px, 48vw) !important;
}

body.wb-sidebar-opened.wb-maximized [class*='detailsCol'] {
  width: calc(100vw - 280px) !important;
}

body.wb-sidebar-opened.wb-maximized [class*='frame'] {
  grid-template-columns: 280px 0px calc(100vw - 280px) !important;
}

/* Base Workbench Sidebar Shell */
.wb-sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #0b0d11;
  color: #d1d7e0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow: hidden;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
}

/* Header Toolbar & Unified Tab Strip */
.wb-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  min-height: 38px;
  background: #11141a;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  padding: 0 8px 0 6px;
  flex: none;
}

.wb-unified-tabstrip {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.wb-unified-tabstrip::-webkit-scrollbar { display: none; }

.wb-unified-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #8b949e;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
  position: relative;
}

.wb-unified-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #c9d1d9;
}

.wb-unified-tab.active {
  background: #181c24;
  border-color: rgba(255, 255, 255, 0.1);
  color: #f0f6fc;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(88, 166, 255, 0.6);
}

.wb-tab-icon { flex: none; color: inherit; }

.wb-tab-label {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-unread-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d29922;
  box-shadow: 0 0 6px rgba(210, 153, 34, 0.6);
  flex: none;
}

.wb-tab-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  color: #6e7681;
  margin-left: 2px;
  transition: all 0.1s ease;
}

.wb-tab-close-btn:hover {
  background: rgba(248, 81, 73, 0.2);
  color: #ff7b72;
}

/* Plus button & dropdown */
.wb-plus-wrapper {
  position: relative;
  display: inline-flex;
}

.wb-plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  background: transparent;
  color: #8b949e;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.wb-plus-btn:hover, .wb-plus-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: #58a6ff;
}

.wb-plus-menu {
  position: absolute;
  top: 30px;
  left: 0;
  z-index: 100;
  min-width: 160px;
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wb-plus-menu button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: #c9d1d9;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.wb-plus-menu button:hover {
  background: #1f2937;
  color: #58a6ff;
}

/* Window Control Actions */
.wb-window-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 8px;
  flex: none;
}

.wb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}
.wb-dot.ok { background: #3fb950; box-shadow: 0 0 6px rgba(63, 185, 80, 0.5); }
.wb-dot.dead { background: #484f58; }

.wb-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  color: #8b949e;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.wb-action-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f0f6fc;
}

.wb-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: rgba(248, 81, 73, 0.12);
  border-bottom: 1px solid rgba(248, 81, 73, 0.25);
  color: #ff7b72;
  font-size: 12px;
}

.wb-alert-banner button {
  background: transparent;
  border: none;
  color: #ff7b72;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.wb-sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: #090d13;
}

/* Pure Full-Height Terminal View */
.wb-term-pure-viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #090d13;
}

.wb-xterm-host {
  flex: 1;
  min-height: 0;
  padding: 8px 12px;
}

.wb-xterm-host .xterm {
  height: 100%;
}

/* In-App Browser View & Omnibox Toolbar (Matching Screenshot) */
.wb-browser-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #0e1117;
}

.wb-browser-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #141720;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex: none;
}

.wb-browser-nav-btns {
  display: flex;
  align-items: center;
  gap: 3px;
}

.wb-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  background: transparent;
  color: #8b949e;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.wb-tool-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f0f6fc;
}

.wb-browser-omnibox {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #090b10;
  border: 1px solid #2d333b;
  border-radius: 6px;
  padding: 4px 10px;
  transition: all 0.15s ease;
}

.wb-browser-omnibox:focus-within {
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
}

.wb-omnibox-icon {
  color: #6e7681;
  flex: none;
}

.wb-omnibox-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e6edf3;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Consolas, monospace;
  outline: none;
  min-width: 0;
}

.wb-browser-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}

.wb-browser-progress {
  height: 2px;
  background: #58a6ff;
  width: 100%;
}

.wb-browser-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #0d1117;
}

.wb-browser-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #0d1117;
  display: block;
}

/* Feature Placeholder Cards (Git) */
.wb-feature-card {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.wb-card-inner {
  max-width: 360px;
  text-align: center;
  background: #141720;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 28px 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.wb-icon-circle {
  width: 48px;
  height: 48px;
  margin: 0 auto 14px auto;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.12);
  color: #58a6ff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wb-card-inner h4 { margin: 0 0 8px 0; color: #f0f6fc; font-size: 15px; font-weight: 600; }
.wb-card-inner p { color: #8b949e; font-size: 12.5px; line-height: 1.6; margin: 0 0 18px 0; }

.wb-feature-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.wb-feature-tags code {
  padding: 3px 8px;
  background: #1f242c;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  font-size: 11px;
  color: #58a6ff;
  font-family: Consolas, monospace;
}

/* Activity Feed */
.wb-activity-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.wb-empty-feed {
  color: #8b949e;
  padding: 40px 20px;
  text-align: center;
}
.wb-empty-icon { color: #484f58; margin-bottom: 10px; }
.wb-empty-title { font-size: 14px; color: #c9d1d9; font-weight: 500; margin: 0 0 6px 0; }
.wb-empty-feed .wb-hint { font-size: 12px; color: #6e7681; margin: 0; line-height: 1.5; }

.wb-activity-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wb-activity-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 5px;
  background: #12151c;
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
}

.wb-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  margin-top: 1px;
}
.wb-badge.human { background: #238636; color: #fff; }
.wb-badge.model { background: #1f6feb; color: #fff; }

.wb-activity-content { flex: 1; min-width: 0; }
.wb-activity-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
.wb-term-name { display: inline-flex; align-items: center; gap: 4px; color: #8b949e; font-size: 11px; }
.wb-activity-time { color: #6e7681; font-size: 11px; font-family: monospace; }
.wb-activity-code {
  display: block;
  font-family: Consolas, Menlo, monospace;
  color: #e6edf3;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
}

/* Header Utilities Toggle Button */
.wb-header-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  color: #8b949e;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wb-header-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.15);
  color: #f0f6fc;
}
`

function injectStyle(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-workbench-styles'
  if (document.querySelector(`style[data-plugin="${tagId}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = tagId
  tag.textContent = WORKBENCH_SIDEBAR_CSS
  document.head.appendChild(tag)
}

interface SlotsService {
  inject(key: string, factory: () => unknown): void
  register(cell: Record<string, unknown>, component: unknown): () => void
}

interface LayoutService {
  openDetails(): void
  closeDetails(): void
}

interface ClientContext {
  slots: SlotsService
  layout?: LayoutService
}

export function apply(ctx: ClientContext): void {
  injectStyle()
  workbenchClient.start()
  setLayoutFace(ctx.layout)

  // 1. Details column registration (Session-attached right sidebar workspace)
  try {
    ctx.slots.inject('details', () => ctx.slots.register({
      name: 'details',
      priority: -1,
      inject: () => ({ closeDetails: () => closeSidebarColumn() }),
    }, SidebarWrapper))
  }
  catch (err) {
    console.warn(`[dsh-workbench] details registration error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Header utility button (Toggle right sidebar in active session header)
  try {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'workbench-toggle',
      order: 80,
    }, HeaderToggleAction))
  }
  catch (err) {
    console.warn(`[dsh-workbench] header utility error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function SidebarWrapper(props: { closeDetails?: () => void; sessionId?: string }): JSX.Element {
  return createElement(WorkbenchSidebar, {
    sessionId: props.sessionId,
    closeDetails: props.closeDetails,
  })
}
