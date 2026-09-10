/**
 * Right-hand workbench column controller.
 *
 * The harness AppFrame owns the three-column grid and rewrites inline
 * `grid-template-columns` on every render, with the details track clamped to
 * 520px by its concession solver. Writing inline styles back at those nodes
 * races the render loop and flaps, so this module never touches harness
 * nodes: it flips classes on <body> and publishes one CSS custom property
 * (`--wb-details-w`) that the injected stylesheet consumes with !important —
 * a single deterministic writer that outranks React's inline styles in the
 * cascade, on every render, forever.
 */

export interface LayoutFace {
  openDetails(): void
  closeDetails(): void
}

let layoutFace: LayoutFace | undefined
let adoptionObserver: MutationObserver | undefined

const STORAGE_KEY_OPEN = 'dsh-workbench-open'
const STORAGE_KEY_WIDTH = 'dsh-workbench-width'
const OPENED_CLASS = 'wb-sidebar-opened'
const MAXIMIZED_CLASS = 'wb-maximized'
const RESIZING_CLASS = 'wb-resizing'
const CLOSING_CLASS = 'wb-closing'

export function setLayoutFace(face?: LayoutFace): void {
  layoutFace = face
  // The workbench opens ONLY in response to explicit intent from now on:
  // a user click on the toggle, an AI summon frame, or the workbench_show
  // tool call. We no longer auto-restore the previous-open state from
  // localStorage at boot — sessions start clean so the right rail is hidden
  // by default until something asks for it.
  void face
}

export function isSidebarOpen(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.classList.contains(OPENED_CLASS)
}

export function isSidebarMaximized(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.classList.contains(MAXIMIZED_CLASS)
}

/** Track width clamp: never thinner than readable, never covering the chat. */
function clampWidth(px: number): number {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const floor = 440
  const ceil = Math.max(vw - 380, floor)
  return Math.round(Math.min(Math.max(px, floor), ceil))
}

export function getEffectiveWidth(): number {
  if (typeof window === 'undefined') return 720
  const saved = Number.parseInt(localStorage.getItem(STORAGE_KEY_WIDTH) ?? '', 10)
  if (Number.isFinite(saved)) return clampWidth(saved)
  return clampWidth(Math.round(window.innerWidth * 0.48))
}

function setWidthVar(px: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--wb-details-w', `${clampWidth(px)}px`)
}

/**
 * Invoke a panel action on the harness layout face. The face throws until the
 * root entry's first render wires the store actions, so open retries a few
 * times; close is best-effort (the stylesheet override is dropped regardless).
 */
function invokeFace(method: 'openDetails' | 'closeDetails', attempt = 0): void {
  try {
    layoutFace?.[method]()
    return
  }
  catch {
    // panel actions not wired yet (boot order) — retry below
  }
  if (attempt < 3) {
    setTimeout(() => invokeFace(method, attempt + 1), 400)
  }
}

export function openSidebarColumn(): void {
  if (typeof document === 'undefined') return
  // The 'true' here is the only way the open state propagates between
  // sessions; we never auto-read it on boot, so a stale 'true' from a prior
  // session is harmless until the user opens us again in this one.
  localStorage.setItem(STORAGE_KEY_OPEN, 'true')
  document.body.classList.remove(CLOSING_CLASS)
  document.body.classList.add(OPENED_CLASS)
  setWidthVar(getEffectiveWidth())
  invokeFace('openDetails')
}

export function closeSidebarColumn(): void {
  if (typeof document === 'undefined') return
  localStorage.setItem(STORAGE_KEY_OPEN, 'false')
  // Spring the exit: hold the track wide for one frame with the closing
  // ease, then drop the opened class so the harness grid springs shut.
  document.body.classList.add(CLOSING_CLASS)
  document.body.classList.remove(OPENED_CLASS, MAXIMIZED_CLASS)
  window.setTimeout(() => {
    document.body.classList.remove(CLOSING_CLASS)
  }, 260)
  invokeFace('closeDetails')
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
  const maximized = document.body.classList.toggle(MAXIMIZED_CLASS)
  notifyResize()
  return maximized
}

export function setCustomWidth(px: number): void {
  if (typeof window === 'undefined') return
  const clamped = clampWidth(px)
  localStorage.setItem(STORAGE_KEY_WIDTH, String(clamped))
  setWidthVar(clamped)
}

/**
 * Tell mounted surfaces to re-measure themselves. The xterm viewports already
 * watch their own box with a ResizeObserver, but a drag ends with a settle
 * frame the observer can miss, and React re-renders driven by the resize are
 * not ordered against the grid change — so the panel also announces the event
 * directly and every viewport re-fits on it.
 */
export function notifyResize(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('wb-resize'))
}

/**
 * Drag on the split handle: while the button is held, move/up listeners live
 * on window (pointer capture is flaky for synthetic and fast pointers), write
 * the width variable at rAF cadence with the frame transition suspended via
 * the wb-resizing class, and persist on release. Double-click resets to the
 * 48vw default.
 */
export function initResizeHandle(handle: HTMLElement): () => void {
  let raf: number | null = null
  let dragging = false
  let startX = 0
  let startWidth = 0

  const applyDrag = (clientX: number): void => {
    if (raf !== null) return
    const width = startWidth + (startX - clientX)
    raf = requestAnimationFrame(() => {
      raf = null
      setWidthVar(width)
      // Same frame as the width write, so the terminal re-fits at the cadence
      // of the pointer instead of one render behind it.
      notifyResize()
    })
  }
  const onWindowPointerMove = (e: PointerEvent): void => {
    if (dragging) applyDrag(e.clientX)
  }
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    const width = startWidth + (startX - e.clientX)
    if (raf !== null) {
      cancelAnimationFrame(raf)
      raf = null
    }
    setWidthVar(width)
    document.body.classList.remove(RESIZING_CLASS)
    localStorage.setItem(STORAGE_KEY_WIDTH, String(clampWidth(width)))
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    notifyResize()
  }
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || isSidebarMaximized()) return
    e.preventDefault()
    dragging = true
    startX = e.clientX
    startWidth = getEffectiveWidth()
    document.body.classList.add(RESIZING_CLASS)
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }
  const onDoubleClick = (): void => {
    localStorage.removeItem(STORAGE_KEY_WIDTH)
    setWidthVar(getEffectiveWidth())
    notifyResize()
  }

  handle.addEventListener('pointerdown', onPointerDown)
  handle.addEventListener('dblclick', onDoubleClick)
  return () => {
    handle.removeEventListener('pointerdown', onPointerDown)
    handle.removeEventListener('dblclick', onDoubleClick)
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }
}

/**
 * Adopt a details column the harness opened on its own (a persisted layout
 * store can boot at a non-zero details width before we ever run): when our
 * root is mounted inside a visibly open column and the user has not just
 * closed the workbench in this session, claim it with our full-width
 * treatment. Only ever adds the class — closing stays exclusively ours — so
 * no feedback loop. The session-level "I closed it" preference (any value
 * other than absent) is honored: once you close the panel in this session,
 * the harness can swing details open for whatever it wants, but we stay
 * folded until you reopen us.
 */
export function installAdoption(): void {
  if (typeof document === 'undefined' || adoptionObserver !== undefined) return
  adoptionObserver = new MutationObserver(() => {
    if (isSidebarOpen()) return
    // Respect an explicit close from the user in the current session.
    if (localStorage.getItem(STORAGE_KEY_OPEN) === 'false') return
    const col = document.querySelector("[class*='detailsCol']")
    if (col instanceof HTMLElement && col.querySelector('.wb-sidebar-root') !== null && col.getBoundingClientRect().width > 80) {
      openSidebarColumn()
    }
  })
  adoptionObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
}
