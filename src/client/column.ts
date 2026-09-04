/**
 * Layout and Width Controller for the Workbench Side-by-Side Panel.
 * Enforces true 48vw half-screen width and full maximization,
 * with state persistence across page reloads.
 * @module dsh-workbench/client/column
 */

export interface LayoutFace {
  openDetails(): void
  closeDetails(): void
}

let layoutFace: LayoutFace | undefined
let observer: MutationObserver | undefined

const STORAGE_KEY = 'dsh-workbench-open'
const OPENED_CLASS = 'wb-sidebar-opened'
const MAXIMIZED_CLASS = 'wb-maximized'

function getTargetWidth(): string {
  if (typeof window === 'undefined') return '680px'
  const half = Math.floor(window.innerWidth * 0.48)
  const target = Math.max(540, Math.min(half, 920))
  return `${target}px`
}

export function setLayoutFace(face?: LayoutFace): void {
  layoutFace = face
  // Restore persisted open state on load
  if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true') {
    openSidebarColumn()
  }
}

export function isSidebarOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.classList.contains(OPENED_CLASS)
}

export function isSidebarMaximized(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.classList.contains(MAXIMIZED_CLASS)
}

function findCol(): HTMLElement | null {
  return document.querySelector("[class*='detailsCol']")
}

function findFrame(): HTMLElement | null {
  return findCol()?.parentElement ?? null
}

function applyStyles(): void {
  const col = findCol()
  const frame = findFrame()
  if (!col || !frame) return

  const maximized = isSidebarMaximized()
  const targetW = getTargetWidth()
  const colWidth = maximized ? 'calc(100vw - 280px)' : targetW
  const gridTemplate = maximized
    ? '280px 0px calc(100vw - 280px)'
    : `280px minmax(0, 1fr) ${targetW}`

  frame.style.setProperty('grid-template-columns', gridTemplate, 'important')
  col.style.setProperty('width', colWidth, 'important')
  col.style.setProperty('display', 'block', 'important')
  col.style.setProperty('overflow', 'visible', 'important')
}

export function openSidebarColumn(): void {
  if (typeof document === 'undefined') return
  document.body.classList.add(OPENED_CLASS)
  localStorage.setItem(STORAGE_KEY, 'true')

  applyStyles()
  layoutFace?.openDetails()

  // Guard against React re-render resetting inline styles
  observer?.disconnect()
  const frame = findFrame()
  if (frame) {
    observer = new MutationObserver(() => {
      if (isSidebarOpen()) {
        const col = findCol()
        if (col && (col.style.width === '0px' || getComputedStyle(col).width === '0px')) {
          applyStyles()
        }
      }
    })
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
  }
}

export function closeSidebarColumn(): void {
  if (typeof document === 'undefined') return
  document.body.classList.remove(OPENED_CLASS)
  document.body.classList.remove(MAXIMIZED_CLASS)
  localStorage.setItem(STORAGE_KEY, 'false')

  observer?.disconnect()
  observer = undefined

  const col = findCol()
  const frame = findFrame()
  if (col && frame) {
    frame.style.setProperty('grid-template-columns', '280px minmax(0, 1fr) 0px', 'important')
    col.style.setProperty('width', '0px', 'important')
  }
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

export function toggleMaximize(): boolean {
  if (typeof document === 'undefined') return false
  const willMaximize = !isSidebarMaximized()
  if (willMaximize) {
    document.body.classList.add(MAXIMIZED_CLASS)
  }
  else {
    document.body.classList.remove(MAXIMIZED_CLASS)
  }
  applyStyles()
  return willMaximize
}
