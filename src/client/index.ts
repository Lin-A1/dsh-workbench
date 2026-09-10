/**
 * dsh-workbench browser half: registers the collaborative workbench as a tab
 * type in the harness right Sidebar.
 * @module dsh-workbench/client
 */

import { createElement } from 'react'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { WORKBENCH_KIND, openWorkbench, setSidebarRight, toggleWorkbench, type SidebarRightFace } from './column.ts'
import { HeaderToggleAction } from './HeaderToggleAction.tsx'
import { workbenchClient } from './ws.ts'
import { WorkbenchSidebar } from './WorkbenchSidebar.tsx'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

/** This implementation's identity in the tab system: the key its body registers under. */
export const WORKBENCH_ID = 'dsh-workbench'

/* ----------------------------------------------------------------------------
 * Design system
 *
 * The harness right Sidebar owns the column, its tab strip, and its panel
 * chrome; everything below styles only the workbench's own surfaces inside one
 * tab body. Palette discipline: the harness paints neutral blacks (body
 * #151517, sidebar #1b1b1c, near-white text). Every workbench tone stays on
 * that neutral axis — no blue-cast grays — so the card reads as the same app.
 * Color is reserved for state (green ok dot, amber reconnect) and data.
 * ------------------------------------------------------------------------- */
const WORKBENCH_SIDEBAR_CSS = `${xtermCss}
:root {
  --wb-page: #151517;                    /* the app's own black          */
  --wb-card: #1b1b1e;                    /* floating card surface        */
  --wb-inset: #131316;                   /* terminal / input wells       */
  --wb-hover: rgba(255, 255, 255, 0.05);
  --wb-active: rgba(255, 255, 255, 0.08);
  --wb-line: rgba(255, 255, 255, 0.06);  /* hairline separators         */
  --wb-line-strong: rgba(255, 255, 255, 0.11);
  --wb-text-1: #e9eaec;
  --wb-text-2: #9b9ba1;
  --wb-text-3: #6b6b72;
  --wb-green: #46c98c;
  --wb-amber: #d9a94e;
  --wb-red: #ef6f61;
  --wb-font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, "Courier New", monospace;
}

/* ---- Light theme: harness flips body[data-ds-dark-theme]; mirror the
   palette onto a GitHub-Light-style neutral axis so the card no longer
   tears a black hole into a bright app. --------------------------------- */
body:not([data-ds-dark-theme]) {
  --wb-page: #f4f5f6;                    /* soft app gray                */
  --wb-card: #ffffff;                    /* floating card surface        */
  --wb-inset: #f0f1f3;                   /* terminal / input wells       */
  --wb-hover: rgba(0, 0, 0, 0.045);
  --wb-active: rgba(0, 0, 0, 0.08);
  --wb-line: rgba(0, 0, 0, 0.09);
  --wb-line-strong: rgba(0, 0, 0, 0.16);
  --wb-text-1: #1f2328;
  --wb-text-2: #59636e;
  --wb-text-3: #8b949e;
  --wb-green: #1a7f37;
  --wb-amber: #9a6700;
  --wb-red: #cf222e;
}

/* ---- Shell: the tab body fills the harness panel ------------------------*/
.wb-sidebar-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  box-sizing: border-box;
  background: var(--wb-page);
  color: var(--wb-text-2);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  font-size: 12px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow: visible;
}

.wb-panel-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--wb-card);
  border-radius: 0;
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

/* ---- Header: the tab strip, then the one control that makes things -------
   This rule went missing in a cleanup, which left the header as a plain block:
   the strip and the control stacked into two full-width rows instead of
   sitting side by side, and that is what made the panel look broken. */
.wb-sidebar-header {
  display: flex;
  align-items: center;
  height: 40px;
  min-height: 40px;
  flex: none;
  gap: 6px;
  padding: 0 8px;
  border-bottom: 1px solid var(--wb-line);
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

/* A tab is a shell (owns the pill background) holding two ordinary sibling
   buttons: one selects, one closes. Nesting the close control inside the tab
   button was invalid interactive content and made the hit targets unreliable. */
.wb-tab-shell {
  display: inline-flex;
  align-items: center;
  flex: none;
  height: 27px;
  border-radius: 6px;
  transition: background 0.12s ease;
}
.wb-tab-shell:hover { background: var(--wb-hover); }
.wb-tab-shell.active { background: var(--wb-active); }

.wb-tab-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding: 0 4px 0 9px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--wb-text-3);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s ease;
}
.wb-tab-shell:hover .wb-tab-main { color: var(--wb-text-2); }
.wb-tab-shell.active .wb-tab-main { color: var(--wb-text-1); }
.wb-tab-icon { flex: none; opacity: 0.9; display: inline-flex; }

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
.wb-tab-shell.active .wb-tab-count { color: var(--wb-text-2); background: rgba(255, 255, 255, 0.09); }

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
  margin-right: 3px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--wb-text-3);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.wb-tab-shell.active .wb-tab-close-btn { opacity: 0.7; }
.wb-tab-shell:hover .wb-tab-close-btn { opacity: 0.7; }
.wb-tab-close-btn:hover {
  opacity: 1;
  background: rgba(239, 111, 97, 0.16);
  color: var(--wb-red);
}

/* ---- The one control that makes things -----------------------------------
   A single `+` at the end of the row of views it creates, listing every view
   kind alike. Before this the browser had a button of its own while the other
   three sat in a menu, so the same idea lived in two controls — and the
   platform's own file browser lived in a third place entirely. */
.wb-new-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  margin-left: 2px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.wb-new-tab:hover, .wb-new-tab.active {
  background: var(--wb-active);
  color: var(--wb-text-1);
}

.wb-plus-menu {
  position: absolute;
  z-index: 100;
  min-width: 214px;
  background: var(--wb-card);
  border: 1px solid var(--wb-line-strong);
  border-radius: 10px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35);
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

/* Empty stage: what the body shows before any tab exists. An explicit pair of
   actions here means "nothing happened" can never be the response to opening
   the panel on a fresh session. */
.wb-empty-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 24px;
  text-align: center;
}
.wb-empty-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 12px;
  border-radius: 14px;
  background: var(--wb-active);
  border: 1px solid var(--wb-line-strong);
  color: var(--wb-text-2);
}
.wb-empty-stage .wb-hint {
  font-size: 12px;
  color: var(--wb-text-3);
  margin: 0 0 18px 0;
  line-height: 1.7;
  max-width: 280px;
}
/* Terminal: pure full-height viewport */
.wb-term-pure-viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wb-inset);
  position: relative;
}
.wb-term-busy-banner {
  position: absolute;
  top: 8px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(27, 27, 30, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(217, 169, 78, 0.4);
  color: #d9a94e;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 20;
  pointer-events: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.wb-term-busy-banner.flash {
  border-color: #ef6f61;
  background: rgba(239, 111, 97, 0.2);
  color: #ffa198;
}
.wb-term-busy-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: wb-pulse 1.2s infinite ease-in-out;
  flex: none;
}
@keyframes wb-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.2); }
}
.wb-busy-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d9a94e;
  margin-left: 2px;
  animation: wb-pulse 1.2s infinite ease-in-out;
  flex: none;
}
.wb-status-busy-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #d9a94e;
  font-weight: 500;
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
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.06);
}
.wb-browser-progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.65), transparent);
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
  background: var(--wb-inset);
}
.wb-browser-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--wb-inset);
  display: block;
}

/* Start page: the fallback for a tab with no address, so a blank tab never
   renders as a dead white rectangle. */
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

/* ---- Git panel: branch header, changed paths, diff viewer ----------------*/
.wb-git-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wb-inset);
}
.wb-git-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--wb-card);
  border-bottom: 1px solid var(--wb-line);
  flex: none;
}
.wb-git-branch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 9px;
  border: 1px solid var(--wb-line-strong);
  border-radius: 6px;
  color: var(--wb-text-2);
  background: var(--wb-hover);
}
.wb-git-branch-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--wb-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 190px;
}
.wb-git-tracking { display: inline-flex; gap: 5px; font-size: 11px; font-variant-numeric: tabular-nums; }
.wb-git-ahead { color: var(--wb-green); }
.wb-git-behind { color: var(--wb-amber); }
.wb-git-numstat {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.wb-git-add { color: var(--wb-green); }
.wb-git-del { color: var(--wb-red); }
.wb-git-count { color: var(--wb-text-3); }
.wb-git-refresh { flex: none; }

.wb-git-notice {
  margin: 0;
  padding: 14px 16px;
  font-size: 12px;
  color: var(--wb-text-3);
  font-family: var(--wb-font-mono);
  word-break: break-word;
}
.wb-git-notice-error { color: var(--wb-red); font-family: inherit; }
.wb-git-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
}
.wb-git-empty .wb-hint { font-size: 12px; color: var(--wb-text-3); margin: 0; line-height: 1.7; max-width: 300px; }
.wb-git-empty code {
  font-family: var(--wb-font-mono);
  background: var(--wb-hover);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--wb-text-2);
}

/* The changed-path list keeps a floor so a long diff can never hide it. */
.wb-git-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.wb-git-files {
  flex: 0 1 auto;
  min-height: 96px;
  max-height: 42%;
  overflow-y: auto;
  padding: 6px 8px;
  border-bottom: 1px solid var(--wb-line);
}
.wb-git-file {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.1s ease;
}
.wb-git-file:hover { background: var(--wb-hover); }
.wb-git-file.active { background: var(--wb-active); }
.wb-git-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 19px;
  height: 17px;
  padding: 0 4px;
  border-radius: 4px;
  font-family: var(--wb-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.wb-git-badge.tone-modified { color: var(--wb-amber); background: rgba(217, 169, 78, 0.14); }
.wb-git-badge.tone-added { color: var(--wb-green); background: rgba(70, 201, 140, 0.14); }
.wb-git-badge.tone-deleted { color: var(--wb-red); background: rgba(239, 111, 97, 0.14); }
.wb-git-badge.tone-untracked { color: var(--wb-text-3); background: var(--wb-hover); }
.wb-git-badge.tone-renamed { color: #79b8ff; background: rgba(121, 184, 255, 0.14); }
.wb-git-badge.tone-conflict { color: #ffa198; background: rgba(239, 111, 97, 0.2); }
.wb-git-path {
  flex: 1;
  min-width: 0;
  font-family: var(--wb-font-mono);
  font-size: 11.5px;
  color: var(--wb-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Paths read from the filename inward, so the tail is what gets room. */
  direction: rtl;
  text-align: left;
}
.wb-git-diff {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wb-git-diff-path {
  flex: none;
  padding: 6px 12px;
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-3);
  background: var(--wb-card);
  border-bottom: 1px solid var(--wb-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.wb-git-diff-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 8px 0;
  font-family: var(--wb-font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  background: var(--wb-inset);
}
/* A diff line is a four-column row: old number, new number, marker, text. The
   marker gets its own column so the eye scans a gutter instead of reading a
   leading character on every line, and both sides carry real line numbers
   parsed from the hunk header. */
.wb-git-diff-line {
  display: flex;
  align-items: baseline;
  padding-right: 10px;
  white-space: pre;
  color: var(--wb-text-2);
}
.wb-git-diff-no {
  flex: none;
  width: 40px;
  padding-right: 8px;
  text-align: right;
  color: var(--wb-text-3);
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.wb-git-diff-mark {
  flex: none;
  width: 15px;
  text-align: center;
  user-select: none;
  opacity: 0.8;
}
.wb-git-diff-text { flex: 1; min-width: 0; }

.wb-git-diff-line.add { background: rgba(70, 201, 140, 0.09); color: #7ee2a8; }
.wb-git-diff-line.del { background: rgba(239, 111, 97, 0.09); color: #ffa198; }
.wb-git-diff-line.hunk {
  background: rgba(121, 184, 255, 0.08);
  color: #79b8ff;
  padding-left: 10px;
  margin: 3px 0;
}
.wb-git-diff-line.meta { color: var(--wb-text-3); }
.wb-git-diff-line.note { color: var(--wb-text-3); font-style: italic; padding-left: 10px; }
body:not([data-ds-dark-theme]) .wb-git-diff-line.add { color: #116329; }
body:not([data-ds-dark-theme]) .wb-git-diff-line.del { color: #a40e26; }

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
.wb-activity-item.src-model::after { border-color: #8b8b92; }

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

/** Stage one of a tab type's registration, as `ctx.sidebarRightTabs` exposes it. */
interface SidebarRightTabsFace {
  register(definition: {
    id: string
    kind: string
    title: (address: string) => string
    guide?: readonly { order: number; title: () => string; description?: () => string }[]
  }): () => void
}

interface ClientContext {
  slots: SlotsService
  sidebarRight?: SidebarRightFace
  sidebarRightTabs?: SidebarRightTabsFace
  effect?(callback: () => (() => void) | void, label?: string): void
}

export function apply(ctx: ClientContext): void {
  injectStyle()
  workbenchClient.start()
  setSidebarRight(ctx.sidebarRight)
  installGlobalShortcuts()

  // Both faces are how the workbench reaches the screen, so a missing one is
  // reported instead of swallowed: the previous implementation called an
  // optional-chained panel action that a harness update had removed, and the
  // whole panel silently stopped mounting with nothing in the console.
  if (ctx.sidebarRightTabs === undefined) {
    console.warn('[dsh-workbench] sidebarRightTabs service is missing: the workbench tab cannot register')
  }
  else {
    // Stage one: what the tab type is. The harness owns the strip, the expand
    // control, and the column geometry; this only names the type.
    ctx.effect?.(() => ctx.sidebarRightTabs!.register({
      id: WORKBENCH_ID,
      kind: WORKBENCH_KIND,
      title: () => '工作台',
      guide: [{
        order: 20,
        title: () => '协同工作台',
        description: () => '与人机共享的终端、网页预览、Git 变更与操作动态',
      }],
    }), 'dsh-workbench: tab type')
  }

  if (ctx.sidebarRight === undefined) {
    console.warn('[dsh-workbench] sidebarRight service is missing: the workbench cannot open itself')
  }

  // Stage two: the body, keyed by the definition's own id. The injected
  // sessionId is the conversation the tab belongs to, and it is what scopes
  // every terminal, browser tab, and Git read this panel asks for.
  try {
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: WORKBENCH_ID,
      inject: (sessionId?: string) => ({ sessionId }),
    }, WorkbenchTabBody))
  }
  catch (err) {
    console.warn(`[dsh-workbench] tab body registration error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // The conversation header keeps a workbench button: the harness's own expand
  // control folds the whole column, while this one is about the workbench tab
  // specifically — bring it forward, or fold the column when it is already the
  // visible tab.
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

/**
 * Global keyboard shortcuts so keyboard-first operators never reach for the
 * mouse: Ctrl+\ (or Cmd+J on macOS) brings the workbench tab forward, or folds
 * the column when it is already showing.
 */
function installGlobalShortcuts(): void {
  if (typeof window === 'undefined') return
  const onKey = (e: KeyboardEvent): void => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (!mod || e.altKey) return

    // Ctrl+\ toggles the panel (VS Code terminal toggle convention)
    if (e.key === '\\') {
      e.preventDefault()
      toggleWorkbench()
      return
    }
    // Cmd+J is the mac-native panel toggle
    if (isMac && e.key.toLowerCase() === 'j' && !e.shiftKey) {
      e.preventDefault()
      toggleWorkbench()
    }
  }
  window.addEventListener('keydown', onKey)
}

/**
 * The registered tab body. The harness composes the slot props; the only one
 * this panel needs is the session the tab is bound to.
 */
function WorkbenchTabBody(props: { sessionId?: string }): JSX.Element {
  return createElement(WorkbenchSidebar, { sessionId: props.sessionId })
}
