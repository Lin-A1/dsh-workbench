/**
 * dsh-workbench browser half. Registers the collaborative workbench inside
 * the right-hand details column, with a toggle button in session utilities.
 * @module dsh-workbench/client
 */

import { createElement } from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { closeSidebarColumn, installAdoption, setLayoutFace } from './column.ts'
import { HeaderToggleAction } from './HeaderToggleAction.tsx'
import { workbenchClient } from './ws.ts'
import { WorkbenchSidebar } from './WorkbenchSidebar.tsx'

export const inject = ['slots', 'layout']

/* ----------------------------------------------------------------------------
 * Design system
 *
 * The harness AppFrame rewrites inline grid styles on every render and clamps
 * the details track to 520px (ui-layout columns.ts). Stylesheet !important
 * outranks inline styles in the cascade, so the workbench width is governed
 * from here — keyed on body classes and one CSS variable written by
 * client/column.ts — never by touching harness nodes.
 * ------------------------------------------------------------------------- */
const WORKBENCH_SIDEBAR_CSS = `${xtermCss}
:root {
  --wb-bg-0: #0a0d13;                    /* deepest: terminal, inputs   */
  --wb-bg-1: #0d1017;                    /* panel base                  */
  --wb-bg-2: #10141c;                    /* header / toolbars           */
  --wb-bg-3: #171c27;                    /* raised: hover, active tab   */
  --wb-bg-4: #1d2432;                    /* highest surface             */
  --wb-line: rgba(148, 163, 184, 0.09);  /* hairline borders            */
  --wb-line-strong: rgba(148, 163, 184, 0.16);
  --wb-text-1: #e2e8f2;
  --wb-text-2: #94a3b8;
  --wb-text-3: #5b6b80;
  --wb-accent: #5b93ff;
  --wb-accent-soft: rgba(91, 147, 255, 0.14);
  --wb-green: #3fce8e;
  --wb-amber: #e0b34d;
  --wb-red: #f47067;
  --wb-radius: 8px;
  --wb-font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, "Courier New", monospace;
}

/* ---- Frame override: the workbench track owns the right half ---------- */
body.wb-sidebar-opened [class*='frame'] {
  grid-template-columns: 280px minmax(0, 1fr) min(var(--wb-details-w, 48vw), 62vw) !important;
  /* The harness's eased grid transition deadlocks on var()-based targets and
     pins the track at its start value; width changes here are instant. */
  transition: none !important;
}
body.wb-sidebar-opened.wb-maximized [class*='frame'] {
  grid-template-columns: 280px 0px calc(100vw - 280px) !important;
}
body.wb-sidebar-opened.wb-maximized [class*='detailsCol'] {
  width: calc(100vw - 280px) !important;
}
/* Width is dragged at pointer cadence — eased tracks would lag the handle */
body.wb-resizing [class*='frame'] {
  transition: none !important;
}
/* The harness's own details drag pill sits at the store width, not ours */
body.wb-sidebar-opened [data-side='details'] {
  display: none !important;
}

/* ---- Shell -------------------------------------------------------------*/
.wb-sidebar-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  background: var(--wb-bg-1);
  color: var(--wb-text-2);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  font-size: 12px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  border-left: 1px solid var(--wb-line);
}
/* Opening still feels smooth: the frame track snaps, the shell fades in */
body.wb-sidebar-opened .wb-sidebar-root {
  animation: wb-root-in 0.18s ease-out;
}
@keyframes wb-root-in {
  from { opacity: 0.35; }
  to { opacity: 1; }
}

/* Slim, quiet scrollbars everywhere inside the workbench */
.wb-sidebar-root * {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.22) transparent;
}
.wb-sidebar-root *::-webkit-scrollbar { width: 10px; height: 10px; }
.wb-sidebar-root *::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.wb-sidebar-root *::-webkit-scrollbar-thumb:hover { background-color: rgba(148, 163, 184, 0.32); }
.wb-sidebar-root *::-webkit-scrollbar-corner { background: transparent; }

.wb-sidebar-root :focus-visible {
  outline: 2px solid rgba(91, 147, 255, 0.55);
  outline-offset: 1px;
  border-radius: 4px;
}

/* ---- Split drag handle --------------------------------------------------*/
.wb-resize-handle {
  position: absolute;
  top: 0;
  left: -3px;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  z-index: 60;
  background: transparent;
  touch-action: none;
}
.wb-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  left: 2px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s ease;
}
.wb-resize-handle:hover::after,
body.wb-resizing .wb-resize-handle::after {
  background: linear-gradient(180deg, transparent, rgba(91, 147, 255, 0.75) 20%, rgba(91, 147, 255, 0.75) 80%, transparent);
}
body.wb-resizing { cursor: col-resize; user-select: none; }

/* ---- Header: unified tab strip + window actions -------------------------*/
.wb-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  min-height: 42px;
  background: var(--wb-bg-2);
  border-bottom: 1px solid var(--wb-line);
  padding: 0 8px 0 8px;
  flex: none;
  gap: 8px;
}

.wb-unified-tabstrip {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 5px 0;
}
.wb-unified-tabstrip::-webkit-scrollbar { display: none; }

.wb-unified-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px 0 9px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--wb-text-3);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.13s ease, color 0.13s ease, border-color 0.13s ease;
  position: relative;
  flex: none;
}
.wb-unified-tab:hover {
  background: rgba(148, 163, 184, 0.08);
  color: var(--wb-text-2);
}
.wb-unified-tab.active {
  background: var(--wb-bg-4);
  border-color: var(--wb-line-strong);
  color: var(--wb-text-1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.045), 0 1px 3px rgba(0, 0, 0, 0.35);
}
.wb-tab-icon { flex: none; opacity: 0.85; }
.wb-unified-tab.active .wb-tab-icon { opacity: 1; }
.wb-tab-term.active .wb-tab-icon { color: var(--wb-green); }
.wb-tab-web.active .wb-tab-icon { color: var(--wb-accent); }
.wb-tab-git.active .wb-tab-icon { color: var(--wb-amber); }
.wb-tab-activity.active .wb-tab-icon { color: #d2a8ff; }

.wb-tab-label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-tab-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--wb-text-3);
  background: rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  padding: 0 5px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}
.wb-unified-tab.active .wb-tab-count { color: var(--wb-text-2); background: rgba(148, 163, 184, 0.16); }

.wb-unread-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--wb-amber);
  flex: none;
  animation: wb-pulse 2.2s ease-in-out infinite;
}
@keyframes wb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.wb-tab-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--wb-text-3);
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.wb-unified-tab.active .wb-tab-close-btn { opacity: 0.7; }
.wb-unified-tab:hover .wb-tab-close-btn { opacity: 0.7; }
.wb-tab-close-btn:hover {
  opacity: 1 !important;
  background: rgba(244, 112, 103, 0.16);
  color: var(--wb-red);
}

/* ---- New-tab button + floating menu -------------------------------------*/
.wb-plus-wrapper { position: relative; display: inline-flex; flex: none; }

.wb-plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.13s ease, color 0.13s ease;
}
.wb-plus-btn:hover, .wb-plus-btn.active {
  background: rgba(148, 163, 184, 0.12);
  color: var(--wb-text-1);
}

.wb-plus-menu {
  position: absolute;
  top: 32px;
  left: 0;
  z-index: 100;
  min-width: 200px;
  background: #151a24;
  border: 1px solid var(--wb-line-strong);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  transform-origin: top left;
  animation: wb-menu-in 0.13s ease-out;
}
@keyframes wb-menu-in {
  from { opacity: 0; transform: scale(0.96) translateY(-3px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.wb-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--wb-text-1);
  font-size: 12px;
  font-family: inherit;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease;
}
.wb-menu-item .wb-menu-icon { color: var(--wb-text-3); display: inline-flex; transition: color 0.1s ease; }
.wb-menu-item:hover { background: rgba(91, 147, 255, 0.12); }
.wb-menu-item:hover .wb-menu-icon { color: var(--wb-accent); }
.wb-menu-sep { height: 1px; margin: 4px 6px; background: var(--wb-line); }

/* ---- Window actions ------------------------------------------------------*/
.wb-window-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 6px;
  flex: none;
  border-left: 1px solid var(--wb-line);
}

.wb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
  margin: 0 4px;
}
.wb-dot.ok {
  background: var(--wb-green);
  box-shadow: 0 0 0 3px rgba(63, 206, 142, 0.12);
}
.wb-dot.dead { background: var(--wb-text-3); box-shadow: none; }

.wb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.13s ease, color 0.13s ease;
}
.wb-icon-btn:hover {
  background: rgba(148, 163, 184, 0.12);
  color: var(--wb-text-1);
}
.wb-icon-btn:active { transform: scale(0.94); }

.wb-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  background: rgba(244, 112, 103, 0.08);
  border-bottom: 1px solid rgba(244, 112, 103, 0.22);
  color: #ff9d96;
  font-size: 12px;
  flex: none;
}
.wb-alert-banner button {
  background: transparent;
  border: none;
  color: #ff9d96;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 4px;
}
.wb-alert-banner button:hover { background: rgba(244, 112, 103, 0.15); }

/* ---- Body regions ---------------------------------------------------------*/
.wb-sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--wb-bg-0);
}

/* Terminal: pure full-height viewport */
.wb-term-pure-viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wb-bg-0);
}
.wb-xterm-host {
  flex: 1;
  min-height: 0;
  padding: 10px 14px 14px;
}
.wb-xterm-host .xterm { height: 100%; }

/* ---- In-app browser -------------------------------------------------------*/
.wb-browser-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #0d1117;
}
.wb-browser-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background: var(--wb-bg-2);
  border-bottom: 1px solid var(--wb-line);
  flex: none;
}
.wb-browser-nav-btns, .wb-browser-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.wb-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.13s ease, color 0.13s ease;
}
.wb-tool-btn:hover {
  background: rgba(148, 163, 184, 0.12);
  color: var(--wb-text-1);
}
.wb-tool-btn:active { transform: scale(0.94); }

.wb-browser-omnibox {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  background: var(--wb-bg-0);
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius);
  padding: 0 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
}
.wb-browser-omnibox:focus-within {
  border-color: rgba(91, 147, 255, 0.55);
  box-shadow: 0 0 0 3px var(--wb-accent-soft);
}
.wb-omnibox-icon { color: var(--wb-text-3); flex: none; display: inline-flex; }
.wb-omnibox-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--wb-text-1);
  font-size: 12.5px;
  font-family: var(--wb-font-mono);
  outline: none;
  min-width: 0;
}
.wb-omnibox-input::placeholder { color: #46536a; }

/* Indeterminate loading shimmer */
.wb-browser-progress {
  position: relative;
  height: 2px;
  flex: none;
  overflow: hidden;
  background: rgba(91, 147, 255, 0.08);
}
.wb-browser-progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--wb-accent), transparent);
  animation: wb-progress-slide 1.1s ease-in-out infinite;
}
@keyframes wb-progress-slide {
  from { transform: translateX(-110%); }
  to { transform: translateX(360%); }
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

/* ---- Placeholder card (Git, phase 2) --------------------------------------*/
.wb-feature-card {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(ellipse 60% 45% at 50% 0%, rgba(91, 147, 255, 0.05), transparent),
    var(--wb-bg-1);
}
.wb-card-inner {
  max-width: 380px;
  text-align: center;
  background: linear-gradient(180deg, #131824, #10141c);
  border: 1px solid var(--wb-line);
  border-radius: 14px;
  padding: 30px 28px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
}
.wb-icon-square {
  width: 46px;
  height: 46px;
  margin: 0 auto 16px auto;
  border-radius: 12px;
  background: var(--wb-accent-soft);
  border: 1px solid rgba(91, 147, 255, 0.22);
  color: var(--wb-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wb-card-inner h4 { margin: 0 0 8px 0; color: var(--wb-text-1); font-size: 14px; font-weight: 600; }
.wb-card-inner p { color: var(--wb-text-2); font-size: 12.5px; line-height: 1.65; margin: 0 0 18px 0; }
.wb-feature-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.wb-feature-tags code {
  padding: 3px 9px;
  background: rgba(91, 147, 255, 0.08);
  border: 1px solid rgba(91, 147, 255, 0.16);
  border-radius: 6px;
  font-size: 11px;
  color: #8fb0ff;
  font-family: var(--wb-font-mono);
}

/* ---- Activity timeline ------------------------------------------------------*/
.wb-activity-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  background: var(--wb-bg-1);
}
.wb-empty-feed {
  color: var(--wb-text-3);
  padding: 48px 24px;
  text-align: center;
}
.wb-empty-icon { color: #39455a; margin-bottom: 12px; }
.wb-empty-title { font-size: 13px; color: var(--wb-text-2); font-weight: 500; margin: 0 0 6px 0; }
.wb-empty-feed .wb-hint { font-size: 12px; color: var(--wb-text-3); margin: 0 auto; line-height: 1.65; max-width: 300px; }

.wb-activity-list {
  display: flex;
  flex-direction: column;
}
.wb-activity-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 0 12px 24px;
}
/* Timeline rail + node */
.wb-activity-item::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--wb-line);
}
.wb-activity-item:first-child::before { top: 14px; }
.wb-activity-item:last-child::before { bottom: auto; height: 14px; }
.wb-activity-item::after {
  content: '';
  position: absolute;
  left: 1px;
  top: 14px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--wb-bg-1);
  border: 2px solid var(--wb-text-3);
  box-sizing: border-box;
  z-index: 1;
}
.wb-activity-item.src-human::after { border-color: var(--wb-green); }
.wb-activity-item.src-model::after { border-color: var(--wb-accent); }

.wb-activity-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wb-badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.02em;
}
.wb-badge.human { color: #52d6a0; background: rgba(63, 206, 142, 0.12); }
.wb-badge.model { color: #85b4ff; background: rgba(91, 147, 255, 0.13); }

.wb-term-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--wb-text-3);
  font-size: 11px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-activity-time {
  margin-left: auto;
  color: #4a5a70;
  font-size: 11px;
  font-family: var(--wb-font-mono);
  font-variant-numeric: tabular-nums;
  flex: none;
}
.wb-activity-code {
  display: block;
  font-family: var(--wb-font-mono);
  font-size: 12px;
  color: var(--wb-text-1);
  background: var(--wb-bg-0);
  border: 1px solid var(--wb-line);
  border-radius: 6px;
  padding: 7px 10px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}
.wb-activity-code .wb-prompt-token { color: #4a5a70; user-select: none; }

/* ---- Session header toggle button ------------------------------------------*/
.wb-header-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--wb-line-strong);
  border-radius: 6px;
  color: var(--wb-text-2);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.13s ease, border-color 0.13s ease, color 0.13s ease;
}
.wb-header-toggle-btn:hover {
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.28);
  color: var(--wb-text-1);
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
  installAdoption()

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
