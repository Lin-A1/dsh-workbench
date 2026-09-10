/**
 * Workbench placement inside the harness right Sidebar.
 *
 * The harness owns the right column outright: its tab strip, its expand control
 * in the conversation header, and its drag handles (which use pointer capture,
 * so a preview iframe can no longer swallow a resize) are the only chrome. The
 * workbench is one tab type inside them, and this module is the thin adapter
 * that opens and toggles that tab.
 *
 * It deliberately owns no geometry. The previous `details`-column implementation
 * fought the frame's column solver from a stylesheet with `!important` rules
 * keyed on body classes, because the harness both rewrote the grid inline and
 * clamped the track; the frame now solves its own columns and reports them, so
 * there is nothing left to fight.
 * @module dsh-workbench/client/column
 */

/** The tab kind the workbench registers; opening it also expands the column. */
export const WORKBENCH_KIND = 'workbench'

/**
 * The slice of `ctx.sidebarRight` this plugin uses. Declared structurally
 * rather than imported, matching how the rest of this client half treats the
 * harness faces: the plugin must not depend on harness client packages.
 */
export interface SidebarRightFace {
  /** Open (or reveal) a page type by kind. The column expands in the same step. */
  openTab(kind: string, options?: unknown): void
  /** Collapse an expanded column, or expand a collapsed one. */
  toggleExpanded(): void
  /** Whether the column is currently showing its panel. */
  isExpanded(): boolean
  /** The active tab of the active pane, when a seat is mounted. */
  active(): { kind?: string } | undefined
}

let sidebarRight: SidebarRightFace | undefined

export function setSidebarRight(face?: SidebarRightFace): void {
  sidebarRight = face
}

/** Whether the right column is showing a panel at all. */
export function isWorkbenchExpanded(): boolean {
  try {
    return sidebarRight?.isExpanded() ?? false
  }
  catch {
    return false
  }
}

/**
 * Reveal the workbench, expanding the column if it is collapsed. Opening is
 * idempotent — the same kind is the same tab — so a model summon and a human
 * click converge instead of stacking panels.
 */
export function openWorkbench(): void {
  sidebarRight?.openTab(WORKBENCH_KIND)
}

/**
 * Toggle: collapse when the workbench is already the visible tab, otherwise
 * bring it forward. Acting on the active tab's kind matters because the column
 * holds other tabs too (the guide, file previews) and collapsing the panel while
 * a file preview is on screen would read as "the workbench button broke".
 * @returns whether the workbench is now the visible tab.
 */
export function toggleWorkbench(): boolean {
  const face = sidebarRight
  if (face === undefined) return false
  let activeKind: string | undefined
  try {
    activeKind = face.active()?.kind
  }
  catch {
    activeKind = undefined
  }
  if (activeKind === WORKBENCH_KIND && isWorkbenchExpanded()) {
    face.toggleExpanded()
    return false
  }
  face.openTab(WORKBENCH_KIND)
  return true
}
