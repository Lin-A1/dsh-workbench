/**
 * Robust controller for the right-hand workbench sidebar column.
 * Directly manages the grid track and details column styles with inline-level
 * authority to guarantee stable three-column side-by-side presentation.
 * @module dsh-workbench/client/column
 */

export interface LayoutFace {
  openDetails(): void
  closeDetails(): void
}

let layoutFace: LayoutFace | undefined
let observer: MutationObserver | undefined
let openState = false

const SIDEBAR_WIDTH = 'min(720px, 48vw)'

export function setLayoutFace(face?: LayoutFace): void {
  layoutFace = face
}

export function isSidebarOpen(): boolean {
  return openState
}

function findCol(): HTMLElement | null {
  return document.querySelector("[class*='detailsCol']")
}

function findFrame(): HTMLElement | null {
  return findCol()?.parentElement ?? null
}

function applyOpenStyles(): void {
  const col = findCol()
  const frame = findFrame()
  if (!col || !frame) return

  frame.style.setProperty('grid-template-columns', `280px minmax(0, 1fr) ${SIDEBAR_WIDTH}`, 'important')
  col.style.setProperty('width', SIDEBAR_WIDTH, 'important')
  col.style.setProperty('display', 'block', 'important')
  col.style.setProperty('overflow', 'visible', 'important')
}

function applyCloseStyles(): void {
  const col = findCol()
  const frame = findFrame()
  if (!col || !frame) return

  frame.style.setProperty('grid-template-columns', '280px minmax(0, 1fr) 0px', 'important')
  col.style.setProperty('width', '0px', 'important')
}

export function openSidebarColumn(): void {
  openState = true
  applyOpenStyles()
  layoutFace?.openDetails()

  // Guard against React re-render resetting the style while open
  observer?.disconnect()
  const frame = findFrame()
  if (frame) {
    observer = new MutationObserver(() => {
      if (openState) {
        const col = findCol()
        if (col && (col.style.width === '0px' || getComputedStyle(col).width === '0px')) {
          applyOpenStyles()
        }
      }
    })
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
  }
}

export function closeSidebarColumn(): void {
  openState = false
  observer?.disconnect()
  observer = undefined
  applyCloseStyles()
  layoutFace?.closeDetails()
}

export function toggleSidebarColumn(): boolean {
  if (isSidebarOpen()) {
    closeSidebarColumn()
    return false
  }
  openSidebarColumn()
  return true
}
