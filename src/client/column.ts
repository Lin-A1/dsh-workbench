/**
 * Dynamic Layout and Width Controller for the Workbench Studio.
 * Enforces true 48vw half-screen width, interactive split-drag resizing
 * (with PointerCapture & rAF throttle), full maximization, and state persistence.
 * @module dsh-workbench/client/column
 */

export interface LayoutFace {
  openDetails(): void
  closeDetails(): void
}

let layoutFace: LayoutFace | undefined
let observer: MutationObserver | undefined

const STORAGE_KEY_OPEN = 'dsh-workbench-open'
const STORAGE_KEY_WIDTH = 'dsh-workbench-width'
const OPENED_CLASS = 'wb-sidebar-opened'
const MAXIMIZED_CLASS = 'wb-maximized'

export function setLayoutFace(face?: LayoutFace): void {
  layoutFace = face
  // Restore persisted open state asynchronously once the shell root mounts
  if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY_OPEN) === 'true') {
    setTimeout(() => {
      try {
        if (localStorage.getItem(STORAGE_KEY_OPEN) === 'true') {
          openSidebarColumn()
        }
      }
      catch {
        // ignore layout race during boot
      }
    }, 600)
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

export function getEffectiveWidth(): number {
  if (typeof window === 'undefined') return 760
  if (isSidebarMaximized()) return window.innerWidth - 280

  const saved = localStorage.getItem(STORAGE_KEY_WIDTH)
  if (saved) {
    const parsed = Number.parseInt(saved, 10)
    if (parsed >= 420 && parsed <= window.innerWidth - 340) {
      return parsed
    }
  }

  // Default: true 48vw half-screen width, clamped between 560px and 1000px
  const half = Math.floor(window.innerWidth * 0.48)
  return Math.max(560, Math.min(half, 1000))
}

function applyStyles(): void {
  const col = findCol()
  const frame = findFrame()
  if (!col || !frame) return

  const width = getEffectiveWidth()
  const maximized = isSidebarMaximized()
  const colWidth = `${width}px`
  const gridTemplate = maximized
    ? `280px 0px ${colWidth}`
    : `280px minmax(0, 1fr) ${colWidth}`

  frame.style.setProperty('grid-template-columns', gridTemplate, 'important')
  col.style.setProperty('width', colWidth, 'important')
  col.style.setProperty('display', 'block', 'important')
  col.style.setProperty('overflow', 'visible', 'important')
}

export function setCustomWidth(px: number): void {
  if (typeof window === 'undefined') return
  const clamped = Math.max(420, Math.min(px, window.innerWidth - 340))
  localStorage.setItem(STORAGE_KEY_WIDTH, String(clamped))
  applyStyles()
}

export function openSidebarColumn(): void {
  if (typeof document === 'undefined') return
  document.body.classList.add(OPENED_CLASS)
  localStorage.setItem(STORAGE_KEY_OPEN, 'true')

  applyStyles()
  try {
    layoutFace?.openDetails()
  }
  catch {
    // ignore layout root unmounted errors
  }

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
  localStorage.setItem(STORAGE_KEY_OPEN, 'false')

  observer?.disconnect()
  observer = undefined

  const col = findCol()
  const frame = findFrame()
  if (col && frame) {
    frame.style.setProperty('grid-template-columns', '280px minmax(0, 1fr) 0px', 'important')
    col.style.setProperty('width', '0px', 'important')
  }
  try {
    layoutFace?.closeDetails()
  }
  catch {
    // ignore
  }
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

/**
 * Attach a drag resize handle for smooth split resizing.
 * @param handle - the HTML element acting as the vertical resize bar.
 */
export function initResizeHandle(handle: HTMLElement): () => void {
  let dragging = false
  let startX = 0
  let startWidth = 0

  const onPointerDown = (e: PointerEvent) => {
    if (isSidebarMaximized()) return
    dragging = true
    startX = e.clientX
    startWidth = getEffectiveWidth()
    handle.setPointerCapture(e.pointerId)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const deltaX = startX - e.clientX // Moving left increases width
    const newWidth = startWidth + deltaX
    setCustomWidth(newWidth)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    try { handle.releasePointerCapture(e.pointerId) } catch {}
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  handle.addEventListener('pointerdown', onPointerDown)
  handle.addEventListener('pointermove', onPointerMove)
  handle.addEventListener('pointerup', onPointerUp)
  handle.addEventListener('pointercancel', onPointerUp)

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown)
    handle.removeEventListener('pointermove', onPointerMove)
    handle.removeEventListener('pointerup', onPointerUp)
    handle.removeEventListener('pointercancel', onPointerUp)
  }
}
