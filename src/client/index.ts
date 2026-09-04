/**
 * dsh-workbench browser half. Registers the "工作台" session-attached view
 * in the conversation.view slot strip.
 * @module dsh-workbench/client
 */

import { createElement } from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { Workbench } from './Workbench.tsx'

export const inject = ['slots']

const WORKBENCH_CSS = `${xtermCss}
.dsh-wb-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #090d13;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.dsh-wb-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex: none;
}

.dsh-wb-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-wb-logo { font-size: 16px; }
.dsh-wb-title { font-weight: 600; font-size: 14px; color: #f0f6fc; }
.dsh-wb-session-chip {
  font-size: 11px;
  padding: 2px 8px;
  background: #21262d;
  border: 1px solid #30363d;
  border-radius: 12px;
  color: #8b949e;
}

.dsh-wb-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.dsh-wb-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #8b949e;
  font-size: 13px;
  cursor: pointer;
  position: relative;
  transition: all 0.15s ease;
}

.dsh-wb-nav-item:hover {
  color: #c9d1d9;
  background: #21262d;
}

.dsh-wb-nav-item.active {
  color: #58a6ff;
  background: #1f2937;
  font-weight: 500;
}

.dsh-wb-unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f0883e;
}

.dsh-wb-status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #8b949e;
}

.dsh-wb-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: #3e1b1b;
  border-bottom: 1px solid #8e2b2b;
  color: #ff7b72;
  font-size: 12px;
}

.dsh-wb-alert button {
  background: transparent;
  border: none;
  color: #ff7b72;
  cursor: pointer;
  font-size: 14px;
}

.dsh-wb-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Terminal View Styles */
.wb-term-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.wb-term-subtabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 12px;
  background: #0d1117;
  border-bottom: 1px solid #21262d;
  flex: none;
  overflow-x: auto;
}

.wb-subtab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #8b949e;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.wb-subtab:hover {
  background: #161b22;
  color: #c9d1d9;
}

.wb-subtab.active {
  background: #161b22;
  color: #f0f6fc;
  box-shadow: inset 0 -2px 0 #58a6ff;
}

.wb-subtab-close {
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 3px;
  color: #6e7681;
}

.wb-subtab-close:hover {
  color: #ff7b72;
  background: #30363d;
}

.wb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}
.wb-dot.ok { background: #3fb950; }
.wb-dot.dead { background: #8b949e; }
.wb-unread { color: #d29922; font-size: 14px; }
.wb-spacer { flex: 1; }

.wb-term-info {
  font-size: 11px;
  color: #6e7681;
  font-family: monospace;
}

.wb-term-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.wb-xterm-host {
  flex: 1;
  min-height: 0;
  padding: 6px 8px;
}

.wb-xterm-host .xterm {
  height: 100%;
}

/* Form Styles */
.wb-form-container {
  max-width: 600px;
  padding: 24px 32px;
  overflow-y: auto;
  font-size: 13px;
}

.wb-form-header h3 {
  margin: 0 0 6px 0;
  font-size: 16px;
  color: #f0f6fc;
}

.wb-form-header p {
  margin: 0 0 20px 0;
  color: #8b949e;
  font-size: 12px;
  line-height: 1.5;
}

.wb-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.wb-form-row label {
  width: 70px;
  color: #8b949e;
  flex: none;
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
  grid-template-columns: 70px 1fr;
  gap: 10px 12px;
  align-items: center;
  margin-bottom: 16px;
}

.wb-form-grid label {
  color: #8b949e;
}

.wb-form-container input, .wb-form-container select {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #c9d1d9;
  padding: 6px 10px;
  font-size: 12px;
}

.wb-form-container input:focus, .wb-form-container select:focus {
  outline: none;
  border-color: #58a6ff;
}

.wb-form-error {
  color: #ff7b72;
  margin-bottom: 12px;
  font-size: 12px;
}

.wb-form-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
}

.wb-btn {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}

.wb-btn:hover { background: #30363d; }
.wb-btn.primary {
  background: #238636;
  border-color: #2ea043;
  color: #ffffff;
}
.wb-btn.primary:hover { background: #2ea043; }
.wb-input-save { max-width: 180px; }

/* Placeholder Cards (Git & Browser) */
.dsh-wb-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.dsh-wb-placeholder-card {
  max-width: 520px;
  text-align: center;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 32px;
}

.dsh-wb-placeholder-icon { font-size: 40px; display: block; margin-bottom: 12px; }
.dsh-wb-placeholder-card h3 { margin: 0 0 8px 0; color: #f0f6fc; font-size: 16px; }
.dsh-wb-placeholder-card p { color: #8b949e; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0; }

.dsh-wb-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.dsh-wb-tags span {
  padding: 4px 10px;
  background: #21262d;
  border-radius: 6px;
  font-size: 11px;
  font-family: monospace;
  color: #58a6ff;
}

/* Activity Feed */
.dsh-wb-activity-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
}

.wb-empty-feed {
  color: #8b949e;
  padding: 24px;
  text-align: center;
}

.wb-empty-feed .wb-hint {
  font-size: 12px;
  color: #6e7681;
}

.wb-activity-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wb-activity-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  background: #161b22;
  border: 1px solid #21262d;
  font-size: 12px;
}

.wb-badge {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}
.wb-badge.human { background: #238636; color: #fff; }
.wb-badge.model { background: #1f6feb; color: #fff; }

.wb-activity-content {
  flex: 1;
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-family: monospace;
}

.wb-term-name { color: #8b949e; font-size: 11px; }
.wb-activity-time { color: #6e7681; font-size: 11px; }
`

function injectStyle(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-workbench-styles'
  if (document.querySelector(`style[data-plugin="${tagId}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = tagId
  tag.textContent = WORKBENCH_CSS
  document.head.appendChild(tag)
}

interface SlotsService {
  inject(key: string, factory: () => unknown): void
  register(cell: Record<string, unknown>, component: unknown): () => void
}

interface ClientContext {
  slots: SlotsService
}

export function apply(ctx: ClientContext): void {
  injectStyle()

  try {
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'workbench',
      order: 30,
      label: () => '工作台',
      inject: (sessionId: string) => ({ sessionId }),
    }, WorkspaceView))
  }
  catch (err) {
    console.warn(`[dsh-workbench] failed to register conversation.view: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function WorkspaceView(props: { sessionId?: string }): JSX.Element {
  return createElement(Workbench, { sessionId: props.sessionId })
}
