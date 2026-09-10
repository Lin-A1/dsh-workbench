/**
 * Session facts a workbench surface needs from the harness.
 *
 * Two questions, both answered from the session store's header record: which
 * directory a conversation owns (so its terminals open in that project instead
 * of wherever dsh-web was launched), and whether a conversation still exists
 * (so terminals orphaned by a deleted conversation can be re-claimed rather
 * than hidden forever behind the per-session filter).
 *
 * Two cordis facts shape the whole module:
 *
 * - The persistence service is optional composition, reached through
 *   `ctx.get()`. An undeclared property read would suspend this plugin's fiber
 *   waiting for a service a profile may never register.
 * - `ctx.get` is a mixed-in accessor bound to the context's reflection layer,
 *   so it must be *called on the context*: a detached reference (local alias,
 *   `.call(other, …)`) resolves against the wrong store and hands back
 *   `undefined` instead of the service.
 *
 * Header access is versioned: newer backends expose `stat(id)`, the 0.1.x
 * backends expose only `list()`. Both are supported, and an unavailable or
 * unreadable store reports "unknown" rather than an answer, so no caller ever
 * mistakes a missing store for a missing session.
 * @module dsh-workbench/session-registry
 */

import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

interface HeaderLike {
  id?: unknown
  cwd?: unknown
}

interface PersistenceLike {
  /** Newer backends: one session's metadata without reading its log. */
  stat?(id: string, ...rest: unknown[]): Promise<{ header?: HeaderLike } | undefined>
  /** Every backend: header-only listing across all project directories. */
  list?(signal?: AbortSignal): Promise<readonly unknown[]>
}

interface SessionFacts {
  /** The session's workspace directory, when the header records one. */
  cwd?: string
}

/** Resolve the workspace directory owned by a session, when one is known. */
export type SessionCwdResolver = (sessionId?: string) => Promise<string | undefined>

/**
 * Whether the store still holds a session under this id. `undefined` means the
 * store could not answer — callers must not read that as "no such session".
 */
export type SessionExistsProbe = (sessionId: string) => Promise<boolean | undefined>

/** `undefined` = the store could not answer; `null` = no such session. */
type LookupResult = SessionFacts | null | undefined

/** How long a header listing is trusted before a miss re-reads it. */
const LIST_TTL_MS = 15_000

interface Lookup {
  get(sessionId: string): Promise<LookupResult>
}

/** The facts we read out of a session header. */
function headerFacts(header: HeaderLike | undefined): SessionFacts | undefined {
  if (header === undefined) return undefined
  const cwd = header.cwd
  return { cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined }
}

/**
 * Normalize one listing row. Newer backends list `{ header }` snapshots, older
 * ones list bare headers; both carry the id and cwd we need.
 */
function rowFacts(row: unknown): { id: string; facts: SessionFacts } | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const entry = row as { id?: unknown; header?: HeaderLike }
  const source = entry.header ?? entry
  const id = typeof source.id === 'string' ? source.id : undefined
  if (id === undefined) return undefined
  return { id, facts: headerFacts(source) ?? {} }
}

function openLookup(ctx: Context): Lookup {
  const settled = new Map<string, LookupResult>()
  let store: PersistenceLike | undefined
  let storeResolved = false
  let listing: Map<string, SessionFacts> | undefined
  let listingAt = 0

  const resolveStore = (): PersistenceLike | undefined => {
    if (storeResolved) return store
    storeResolved = true
    try {
      store = (ctx as unknown as { get(name: string): unknown }).get('sessionPersistence') as PersistenceLike | undefined
    }
    catch {
      store = undefined
    }
    return store
  }

  /** Header map from `list()`, re-read when stale; `undefined` when unreadable. */
  const readListing = async (force: boolean): Promise<Map<string, SessionFacts> | undefined> => {
    if (!force && listing !== undefined && Date.now() - listingAt < LIST_TTL_MS) return listing
    const persistence = resolveStore()
    const list = persistence?.list
    if (persistence === undefined || list === undefined) return undefined
    try {
      const rows = await list.call(persistence)
      const next = new Map<string, SessionFacts>()
      for (const row of rows) {
        const entry = rowFacts(row)
        if (entry !== undefined) next.set(entry.id, entry.facts)
      }
      listing = next
      listingAt = Date.now()
      return next
    }
    catch {
      return undefined
    }
  }

  const lookupOnce = async (sessionId: string): Promise<LookupResult> => {
    const persistence = resolveStore()
    if (persistence === undefined) return undefined
    try {
      const stat = persistence.stat
      if (typeof stat === 'function') {
        const snapshot = await stat.call(persistence, sessionId)
        return headerFacts(snapshot?.header) ?? (snapshot === undefined ? null : {})
      }
      let headers = await readListing(false)
      if (headers === undefined) return undefined
      if (headers.has(sessionId)) return headers.get(sessionId)
      // A miss may just mean the cached listing predates the session.
      headers = await readListing(true)
      if (headers === undefined) return undefined
      return headers.has(sessionId) ? headers.get(sessionId) : null
    }
    catch {
      return undefined
    }
  }

  return {
    async get(sessionId) {
      const cached = settled.get(sessionId)
      if (cached !== undefined) return cached
      const result = await lookupOnce(sessionId)
      // Only definitive answers are cached; "could not ask" stays retryable.
      if (result !== undefined) settled.set(sessionId, result)
      return result
    },
  }
}

/** The two session questions, answered from one shared store read. */
export interface SessionDirectory {
  resolveCwd: SessionCwdResolver
  exists: SessionExistsProbe
}

/**
 * Build the shared, memoized session directory view. One `list()`/`stat()`
 * conversation per process backs both answers, since they read the same header.
 * @param ctx - plugin context, used for the optional `sessionPersistence` lookup.
 * @returns a resolver that never rejects plus an existence probe that reports
 * `undefined` when the store could not answer.
 */
export function createSessionDirectory(ctx: Context): SessionDirectory {
  const lookup = openLookup(ctx)
  return {
    resolveCwd: async (sessionId) => {
      if (!sessionId) return undefined
      const cwd = (await lookup.get(sessionId))?.cwd
      // A recorded directory can be gone (moved or deleted project); handing it
      // to a shell would fail the spawn, so it counts as unresolved.
      return cwd !== undefined && existsSync(cwd) ? cwd : undefined
    },
    exists: async (sessionId) => {
      const result = await lookup.get(sessionId)
      return result === undefined ? undefined : result !== null
    },
  }
}
