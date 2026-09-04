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
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4);
}

/* Header Toolbar */
.wb-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #12151c;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex: none;
}

.wb-sidebar-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
}

.wb-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #8b949e;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.wb-tab-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e6edf3;
}

.wb-tab-btn.active {
  background: rgba(56, 139, 253, 0.12);
  border-color: rgba(56, 139, 253, 0.3);
  color: #58a6ff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.wb-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d29922;
  box-shadow: 0 0 6px rgba(210, 153, 34, 0.6);
}

.wb-tab-count {
  font-size: 10px;
  padding: 1px 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: #8b949e;
  font-family: monospace;
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
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  color: #8b949e;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wb-close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f0f6fc;
  border-color: rgba(255, 255, 255, 0.1);
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
  background: #0a0d12;
}

/* Terminal View & Subtabs */
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
  padding: 4px 8px;
  background: #0e1117;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex: none;
  min-height: 32px;
}

.wb-term-tabs-scroll {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow-x: auto;
  max-width: calc(100% - 28px);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.wb-term-tabs-scroll::-webkit-scrollbar {
  height: 3px;
}

.wb-term-tabs-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.wb-subtab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #8b949e;
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
}

.wb-subtab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #c9d1d9;
}

.wb-subtab.active {
  background: #161b22;
  border-color: rgba(255, 255, 255, 0.09);
  color: #f0f6fc;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.wb-subtab-title {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: monospace;
}

.wb-unread-pill {
  font-size: 9px;
  background: rgba(210, 153, 34, 0.2);
  color: #e3b341;
  padding: 0 5px;
  border-radius: 8px;
  font-family: monospace;
}

.wb-subtab-close {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 3px;
  color: #6e7681;
  transition: all 0.1s ease;
}

.wb-subtab-close:hover {
  color: #ff7b72;
  background: rgba(248, 81, 73, 0.15);
}

.wb-subtab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  color: #8b949e;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wb-subtab-add:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #58a6ff;
  border-color: rgba(88, 166, 255, 0.2);
}

.wb-subtab-add.active {
  color: #58a6ff;
  background: rgba(56, 139, 253, 0.12);
  border-color: rgba(56, 139, 253, 0.3);
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

.wb-term-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #0a0d12;
}

.wb-xterm-host {
  flex: 1;
  min-height: 0;
  padding: 6px 10px;
}

.wb-xterm-host .xterm {
  height: 100%;
}

.wb-term-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 12px;
  background: #0d1117;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: #7d8590;
  flex: none;
}

.wb-footer-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wb-footer-spacer { flex: 1; }

.wb-footer-mono {
  font-family: Consolas, monospace;
}

/* Modern Minimalist Connect Form */
.wb-form-container {
  padding: 20px 24px;
  overflow-y: auto;
  font-size: 12.5px;
}

.wb-form-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wb-form-title-row h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #f0f6fc;
}

.wb-icon-btn {
  background: transparent;
  border: none;
  color: #8b949e;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 4px;
}
.wb-icon-btn:hover { color: #f0f6fc; background: rgba(255, 255, 255, 0.08); }

.wb-form-header p {
  margin: 6px 0 16px 0;
  color: #8b949e;
  font-size: 11.5px;
  line-height: 1.5;
}

.wb-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.wb-form-row label {
  width: 64px;
  color: #8b949e;
  flex: none;
  font-weight: 500;
}

.wb-radio-group {
  display: flex;
  gap: 16px;
}

.wb-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #c9d1d9;
}

.wb-form-grid {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px 12px;
  align-items: center;
  margin-bottom: 18px;
}

.wb-form-grid label {
  color: #8b949e;
  font-weight: 500;
}

.wb-form-container input, .wb-form-container select {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 5px;
  color: #e6edf3;
  padding: 6px 10px;
  font-size: 12px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.wb-form-container input:focus, .wb-form-container select:focus {
  outline: none;
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
}

.wb-form-error {
  color: #ff7b72;
  margin-bottom: 12px;
  font-size: 11.5px;
}

.wb-form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.wb-btn {
  padding: 6px 14px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.wb-btn:hover {
  background: #30363d;
  color: #f0f6fc;
}

.wb-btn.primary {
  background: #238636;
  border-color: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.wb-btn.primary:hover { background: #2ea043; }
.wb-input-save { max-width: 130px; }

/* Feature Placeholders (Git & Browser) */
.wb-feature-card {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.wb-card-inner {
  max-width: 340px;
  text-align: center;
  background: #12151c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 28px 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
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
  box-shadow: 0 0 12px rgba(88, 166, 255, 0.15);
}

.wb-card-inner h4 { margin: 0 0 8px 0; color: #f0f6fc; font-size: 14.5px; font-weight: 600; }
.wb-card-inner p { color: #8b949e; font-size: 12px; line-height: 1.6; margin: 0 0 18px 0; }

.wb-feature-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.wb-feature-tags code {
  padding: 2px 7px;
  background: #1f242c;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  font-size: 10.5px;
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
.wb-empty-title { font-size: 13.5px; color: #c9d1d9; font-weight: 500; margin: 0 0 6px 0; }
.wb-empty-feed .wb-hint { font-size: 11.5px; color: #6e7681; margin: 0; line-height: 1.5; }

.wb-activity-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wb-activity-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  background: #0f1218;
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 11.5px;
}

.wb-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 600;
  margin-top: 1px;
}
.wb-badge.human { background: #238636; color: #fff; }
.wb-badge.model { background: #1f6feb; color: #fff; }

.wb-activity-content { flex: 1; min-width: 0; }
.wb-activity-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
.wb-term-name { display: inline-flex; align-items: center; gap: 4px; color: #8b949e; font-size: 10.5px; }
.wb-activity-time { color: #6e7681; font-size: 10.5px; font-family: monospace; }
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
  gap: 5px;
  padding: 4px 9px;
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
