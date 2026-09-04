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
 *
 * Visual language: a calm floating card on the app background — quiet grays,
 * hairline separators, generous row spacing; color is reserved for state
 * (green ok dot, amber reconnect) and data (+adds / −dels), never decoration.
 * ------------------------------------------------------------------------- */
const WORKBENCH_SIDEBAR_CSS = `${xtermCss}
:root {
  --wb-card: #171b23;                    /* floating card surface       */
  --wb-inset: #10141a;                   /* terminal / input wells      */
  --wb-hover: rgba(255, 255, 255, 0.05);
  --wb-active: rgba(255, 255, 255, 0.08);
  --wb-line: rgba(255, 255, 255, 0.06);  /* hairline separators         */
  --wb-line-strong: rgba(255, 255, 255, 0.11);
  --wb-text-1: #dee4ee;
  --wb-text-2: #97a1b0;
  --wb-text-3: #66707f;
  --wb-green: #46c98c;
  --wb-amber: #d9a94e;
  --wb-red: #ef6f61;
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
body.wb-resizing [class*='frame'] {
  transition: none !important;
}
body.wb-sidebar-opened [data-side='details'] {
  display: none !important;
}

/* ---- Shell: transparent gap + floating card -----------------------------*/
.wb-sidebar-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  padding: 10px 12px 10px 8px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base, #101319);
  color: var(--wb-text-2);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  font-size: 12px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow: visible;
}
body.wb-sidebar-opened .wb-sidebar-root {
  animation: wb-root-in 0.16s ease-out;
}
@keyframes wb-root-in {
  from { opacity: 0.4; }
  to { opacity: 1; }
}

.wb-panel-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--wb-card);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

/* Slim, quiet scrollbars */
.wb-panel-card * {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
}
.wb-panel-card *::-webkit-scrollbar { width: 10px; height: 10px; }
.wb-panel-card *::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.wb-panel-card *::-webkit-scrollbar-thumb:hover { background-color: rgba(255, 255, 255, 0.22); }
.wb-panel-card *::-webkit-scrollbar-corner { background: transparent; }
.wb-panel-card :focus-visible {
  outline: 2px solid rgba(122, 162, 255, 0.5);
  outline-offset: 1px;
  border-radius: 4px;
}

/* ---- Split drag handle (straddles the column edge) ----------------------*/
.wb-resize-handle {
  position: absolute;
  top: 0;
  left: -12px;
  width: 12px;
  height: 100%;
  cursor: col-resize;
  z-index: 60;
  background: transparent;
  touch-action: none;
}
.wb-resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease;
}
.wb-resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 3px;
  width: 6px;
  height: 42px;
  transform: translateY(-50%);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.09);
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.wb-resize-handle:hover::before,
body.wb-resizing .wb-resize-handle::before {
  background: rgba(122, 162, 255, 0.55);
}
.wb-resize-handle:hover::after,
body.wb-resizing .wb-resize-handle::after {
  opacity: 1;
  background: rgba(122, 162, 255, 0.25);
  border-color: rgba(122, 162, 255, 0.35);
}
body.wb-resizing { cursor: col-resize; user-select: none; }

/* ---- Header: brand + tabs + window actions ------------------------------*/
.wb-sidebar-header {
  display: flex;
  align-items: center;
  height: 44px;
  min-height: 44px;
  padding: 0 8px 0 12px;
  flex: none;
  gap: 6px;
  border-bottom: 1px solid var(--wb-line);
}

.wb-brand {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
  padding-right: 10px;
  margin-right: 4px;
  border-right: 1px solid var(--wb-line);
  user-select: none;
}
.wb-brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--wb-active);
  color: var(--wb-text-2);
}
.wb-brand-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--wb-text-1);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.wb-unified-tabstrip {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 6px 0;
}
.wb-unified-tabstrip::-webkit-scrollbar { display: none; }

.wb-unified-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding: 0 9px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--wb-text-3);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
  flex: none;
}
.wb-unified-tab:hover {
  background: var(--wb-hover);
  color: var(--wb-text-2);
}
.wb-unified-tab.active {
  background: var(--wb-active);
  color: var(--wb-text-1);
}
.wb-tab-icon { flex: none; opacity: 0.9; }

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
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 0 5px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}
.wb-unified-tab.active .wb-tab-count { color: var(--wb-text-2); background: rgba(255, 255, 255, 0.09); }

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
  background: rgba(239, 111, 97, 0.16);
  color: var(--wb-red);
}

/* ---- New-tab button + floating menu -------------------------------------*/
.wb-plus-wrapper { position: relative; display: inline-flex; flex: none; }

.wb-plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.wb-plus-btn:hover, .wb-plus-btn.active {
  background: var(--wb-hover);
  color: var(--wb-text-1);
}

.wb-plus-menu {
  position: absolute;
  top: 32px;
  left: 0;
  z-index: 100;
  min-width: 200px;
  background: #1d222b;
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
.wb-menu-item:hover { background: var(--wb-active); }
.wb-menu-item:hover .wb-menu-icon { color: var(--wb-text-1); }
.wb-menu-sep { height: 1px; margin: 4px 6px; background: var(--wb-line); }

/* ---- Window actions ------------------------------------------------------*/
.wb-window-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  padding-left: 8px;
  flex: none;
}

.wb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
  margin: 0 5px;
}
.wb-dot.ok {
  background: var(--wb-green);
  box-shadow: 0 0 0 3px rgba(70, 201, 140, 0.12);
}
.wb-dot.dead { background: var(--wb-text-3); box-shadow: none; }

.wb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.wb-icon-btn:hover {
  background: var(--wb-hover);
  color: var(--wb-text-1);
}
.wb-icon-btn:active { transform: scale(0.94); }

.wb-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  background: rgba(239, 111, 97, 0.08);
  border-bottom: 1px solid rgba(239, 111, 97, 0.2);
  color: #f0968d;
  font-size: 12px;
  flex: none;
}
.wb-alert-banner button {
  background: transparent;
  border: none;
  color: #f0968d;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 4px;
}
.wb-alert-banner button:hover { background: rgba(239, 111, 97, 0.15); }

/* ---- Body regions ---------------------------------------------------------*/
.wb-sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--wb-inset);
}

/* Terminal: pure full-height viewport */
.wb-term-pure-viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wb-inset);
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
  background: var(--wb-inset);
}
.wb-browser-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--wb-card);
  border-bottom: 1px solid var(--wb-line);
  flex: none;
}
.wb-browser-nav-btns, .wb-browser-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: none;
}
.wb-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.wb-tool-btn:hover {
  background: var(--wb-hover);
  color: var(--wb-text-1);
}
.wb-tool-btn:active { transform: scale(0.94); }

.wb-browser-omnibox {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  background: var(--wb-inset);
  border: 1px solid var(--wb-line);
  border-radius: 8px;
  padding: 0 11px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
}
.wb-browser-omnibox:focus-within {
  border-color: rgba(122, 162, 255, 0.45);
  box-shadow: 0 0 0 3px rgba(122, 162, 255, 0.1);
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
.wb-omnibox-input::placeholder { color: #4a5260; }

.wb-browser-progress {
  position: relative;
  height: 2px;
  flex: none;
  overflow: hidden;
  background: rgba(122, 162, 255, 0.08);
}
.wb-browser-progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(122, 162, 255, 0.9), transparent);
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
  background: #0e1116;
}
.wb-browser-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #0e1116;
  display: block;
}

/* Start page: replaces the iframe until a URL is committed (no dead white) */
.wb-start-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--wb-inset);
}
.wb-start-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border-radius: 14px;
  background: var(--wb-active);
  border: 1px solid var(--wb-line-strong);
  color: var(--wb-text-2);
  margin-bottom: 15px;
}
.wb-start-title {
  margin: 0 0 6px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--wb-text-1);
}
.wb-start-hint {
  margin: 0 0 20px 0;
  font-size: 12px;
  color: var(--wb-text-3);
}
.wb-start-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.wb-start-chip {
  display: inline-flex;
  align-items: center;
  height: 27px;
  padding: 0 13px;
  background: var(--wb-hover);
  border: 1px solid var(--wb-line);
  border-radius: 999px;
  color: var(--wb-text-2);
  font-size: 11.5px;
  font-family: var(--wb-font-mono);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wb-start-chip:hover {
  background: var(--wb-active);
  border-color: var(--wb-line-strong);
  color: var(--wb-text-1);
}

/* ---- Activity timeline ------------------------------------------------------*/
.wb-activity-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  background: var(--wb-inset);
}
.wb-empty-feed {
  color: var(--wb-text-3);
  padding: 48px 24px;
  text-align: center;
}
.wb-empty-icon { color: #39404c; margin-bottom: 12px; }
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
  background: var(--wb-inset);
  border: 2px solid var(--wb-text-3);
  box-sizing: border-box;
  z-index: 1;
}
.wb-activity-item.src-human::after { border-color: var(--wb-green); }
.wb-activity-item.src-model::after { border-color: #7a9ae8; }

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
.wb-badge.human { color: #5ecfa0; background: rgba(70, 201, 140, 0.1); }
.wb-badge.model { color: #9cb4e8; background: rgba(122, 154, 232, 0.12); }

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
  color: #4c5462;
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--wb-line);
  border-radius: 6px;
  padding: 7px 10px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}
.wb-activity-code .wb-prompt-token { color: #4c5462; user-select: none; }

/* ---- Status bar -------------------------------------------------------------*/
.wb-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 27px;
  min-height: 27px;
  padding: 0 12px;
  background: var(--wb-card);
  border-top: 1px solid var(--wb-line);
  font-size: 11px;
  color: var(--wb-text-3);
  flex: none;
  user-select: none;
}
.wb-status-left, .wb-status-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wb-status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.wb-status-item .wb-status-icon { display: inline-flex; color: var(--wb-text-3); }
.wb-status-strong { color: var(--wb-text-2); font-weight: 500; }
.wb-status-path {
  font-family: var(--wb-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.wb-status-size { font-family: var(--wb-font-mono); font-variant-numeric: tabular-nums; }
.wb-status-sep { width: 1px; height: 12px; background: var(--wb-line-strong); flex: none; }
.wb-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.wb-status-dot.ok { background: var(--wb-green); box-shadow: 0 0 0 2.5px rgba(70, 201, 140, 0.13); }
.wb-status-dot.dead { background: var(--wb-amber); box-shadow: 0 0 0 2.5px rgba(217, 169, 78, 0.13); animation: wb-pulse 1.6s ease-in-out infinite; }
.wb-status-dot.exited { background: var(--wb-red); box-shadow: 0 0 0 2.5px rgba(239, 111, 97, 0.13); }
.wb-status-sync-ok { color: #5ecfa0; }
.wb-status-sync-warn { color: var(--wb-amber); }

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
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wb-header-toggle-btn:hover {
  background: var(--wb-hover);
  border-color: rgba(255, 255, 255, 0.2);
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
