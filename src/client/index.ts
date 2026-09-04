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
/* Force stable three-column side-by-side grid when sidebar is opened */
body.wb-sidebar-opened [class*='detailsCol'] {
  display: block !important;
  width: min(520px, 42vw) !important;
  min-width: 320px !important;
  max-width: 600px !important;
  overflow: visible !important;
  flex: none !important;
}

body.wb-sidebar-opened [class*='frame'] {
  grid-template-columns: 280px minmax(0, 1fr) min(520px, 42vw) !important;
}

/* Floating Quick Toggle Button for zero-friction access across all pages */
.wb-floating-trigger {
  position: fixed;
  top: 14px;
  right: 18px;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 6px;
  background: rgba(22, 27, 34, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #c9d1d9;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  transition: all 0.18s ease;
}

.wb-floating-trigger:hover {
  background: rgba(33, 38, 45, 0.95);
  border-color: #58a6ff;
  color: #58a6ff;
}

body.wb-sidebar-opened .wb-floating-trigger {
  display: none;
}

.wb-sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #090d13;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  overflow: hidden;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.wb-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #0d1117;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex: none;
}

.wb-sidebar-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
}

.wb-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #8b949e;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
}

.wb-tab-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #c9d1d9;
}

.wb-tab-btn.active {
  background: #161b22;
  color: #58a6ff;
  font-weight: 500;
  box-shadow: inset 0 -2px 0 #58a6ff;
}

.wb-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d29922;
}

.wb-tab-count {
  font-size: 10px;
  padding: 1px 5px;
  background: #21262d;
  border-radius: 10px;
  color: #8b949e;
}

.wb-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wb-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: #8b949e;
  border-radius: 4px;
  cursor: pointer;
}

.wb-close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f0f6fc;
}

.wb-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(248, 81, 73, 0.15);
  border-bottom: 1px solid rgba(248, 81, 73, 0.3);
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
}

/* Terminal View */
.wb-term-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.wb-term-subtabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  background: #0a0d12;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex: none;
}

.wb-term-tabs-scroll {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  max-width: calc(100% - 28px);
}

.wb-subtab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #8b949e;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.wb-subtab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #c9d1d9;
}

.wb-subtab.active {
  background: #161b22;
  color: #f0f6fc;
}

.wb-subtab-title {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wb-unread-pill {
  font-size: 9px;
  background: rgba(210, 153, 34, 0.2);
  color: #d29922;
  padding: 0 4px;
  border-radius: 6px;
}

.wb-subtab-close {
  display: inline-flex;
  align-items: center;
  padding: 1px;
  border-radius: 2px;
  color: #6e7681;
}

.wb-subtab-close:hover {
  color: #ff7b72;
  background: rgba(255, 255, 255, 0.1);
}

.wb-subtab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: #8b949e;
  border-radius: 3px;
  cursor: pointer;
}

.wb-subtab-add:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #58a6ff;
}

.wb-subtab-add.active {
  color: #58a6ff;
  background: #161b22;
}

.wb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}
.wb-dot.ok { background: #3fb950; box-shadow: 0 0 6px rgba(63, 185, 80, 0.4); }
.wb-dot.dead { background: #484f58; }

.wb-term-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #090d13;
}

.wb-xterm-host {
  flex: 1;
  min-height: 0;
  padding: 4px 6px;
}

.wb-xterm-host .xterm {
  height: 100%;
}

.wb-term-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  background: #0d1117;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 10px;
  color: #6e7681;
  flex: none;
}

.wb-footer-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.wb-footer-spacer { flex: 1; }

.wb-footer-mono {
  font-family: Consolas, monospace;
}

/* Connect Form */
.wb-form-container {
  padding: 16px 20px;
  overflow-y: auto;
  font-size: 12px;
}

.wb-form-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wb-form-title-row h4 {
  margin: 0;
  font-size: 13px;
  color: #f0f6fc;
}

.wb-icon-btn {
  background: transparent;
  border: none;
  color: #8b949e;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 2px;
}
.wb-icon-btn:hover { color: #f0f6fc; }

.wb-form-header p {
  margin: 6px 0 16px 0;
  color: #8b949e;
  font-size: 11px;
  line-height: 1.4;
}

.wb-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.wb-form-row label {
  width: 60px;
  color: #8b949e;
  flex: none;
}

.wb-radio-group {
  display: flex;
  gap: 14px;
}

.wb-radio {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: #c9d1d9;
}

.wb-form-grid {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 8px 10px;
  align-items: center;
  margin-bottom: 16px;
}

.wb-form-grid label {
  color: #8b949e;
}

.wb-form-container input, .wb-form-container select {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  color: #c9d1d9;
  padding: 5px 8px;
  font-size: 12px;
}

.wb-form-container input:focus, .wb-form-container select:focus {
  outline: none;
  border-color: #58a6ff;
}

.wb-form-error {
  color: #ff7b72;
  margin-bottom: 10px;
  font-size: 11px;
}

.wb-form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.wb-btn {
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid #30363d;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  font-size: 11px;
}

.wb-btn:hover { background: #30363d; }
.wb-btn.primary {
  background: #238636;
  border-color: #2ea043;
  color: #ffffff;
}
.wb-btn.primary:hover { background: #2ea043; }
.wb-input-save { max-width: 120px; }

/* Feature Placeholders */
.wb-feature-card {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.wb-card-inner {
  max-width: 320px;
  text-align: center;
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 24px 20px;
}

.wb-icon-circle {
  width: 44px;
  height: 44px;
  margin: 0 auto 12px auto;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.1);
  color: #58a6ff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wb-card-inner h4 { margin: 0 0 6px 0; color: #f0f6fc; font-size: 14px; }
.wb-card-inner p { color: #8b949e; font-size: 12px; line-height: 1.5; margin: 0 0 16px 0; }

.wb-feature-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.wb-feature-tags code {
  padding: 2px 6px;
  background: #21262d;
  border-radius: 4px;
  font-size: 10px;
  color: #58a6ff;
  font-family: Consolas, monospace;
}

/* Activity Feed */
.wb-activity-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.wb-empty-feed {
  color: #8b949e;
  padding: 32px 16px;
  text-align: center;
}
.wb-empty-icon { color: #484f58; margin-bottom: 8px; }
.wb-empty-title { font-size: 13px; color: #c9d1d9; margin: 0 0 4px 0; }
.wb-empty-feed .wb-hint { font-size: 11px; color: #6e7681; margin: 0; }

.wb-activity-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wb-activity-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: #0d1117;
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
}

.wb-badge {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  margin-top: 1px;
}
.wb-badge.human { background: #238636; color: #fff; }
.wb-badge.model { background: #1f6feb; color: #fff; }

.wb-activity-content { flex: 1; min-width: 0; }
.wb-activity-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.wb-term-name { display: inline-flex; align-items: center; gap: 4px; color: #8b949e; font-size: 10px; }
.wb-activity-time { color: #6e7681; font-size: 10px; }
.wb-activity-code {
  display: block;
  font-family: Consolas, Menlo, monospace;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Header Utilities Toggle Button */
.wb-header-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #8b949e;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wb-header-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.06);
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

