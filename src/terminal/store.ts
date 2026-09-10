/**
 * Persistent storage for active terminal specifications.
 *
 * Allows local and SSH terminal sessions to survive service restarts: specs are
 * written on open and removed on close; at boot the manager restores un-closed
 * terminals under their original IDs so the journal replay history aligns
 * seamlessly.
 *
 * Every mutation is a read-modify-write of one JSON file, so mutations are
 * serialized through a promise chain: two terminals opened in the same tick
 * (the model opens one while the human clicks "+") would otherwise each read
 * the same list and the second write would drop the first spec — losing a
 * terminal on the next restart, the exact failure this store exists to prevent.
 * @module dsh-workbench/terminal/store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TerminalKind } from '../types.ts'

export interface PersistedTerminalSpec {
  id: string
  kind: TerminalKind
  name?: string
  sessionId?: string
  cwd?: string
  host?: string
  user?: string
  port?: number
  identityFile?: string
  echo?: boolean
  createdAt: number
}

export class TerminalStore {
  private readonly file: string
  /** Tail of the mutation chain; each mutation runs only after the previous one settled. */
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(private readonly dataDir: string) {
    this.file = join(this.dataDir, 'active_terminals.json')
  }

  async list(): Promise<PersistedTerminalSpec[]> {
    try {
      const content = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed : []
    }
    catch {
      return []
    }
  }

  /** Insert or replace one spec. */
  save(spec: PersistedTerminalSpec): Promise<void> {
    return this.enqueue((list) => {
      const index = list.findIndex(item => item.id === spec.id)
      if (index >= 0) list[index] = spec
      else list.push(spec)
      return list
    })
  }

  /** Drop one spec; a no-op when it is already absent. */
  remove(id: string): Promise<void> {
    return this.enqueue((list) => {
      const filtered = list.filter(item => item.id !== id)
      return filtered.length === list.length ? undefined : filtered
    })
  }

  /**
   * Run one read-modify-write cycle, ordered behind every cycle already queued.
   * @param change - rewrites the list, or returns `undefined` to skip the write.
   */
  private enqueue(change: (list: PersistedTerminalSpec[]) => PersistedTerminalSpec[] | undefined): Promise<void> {
    const run = this.mutations.then(async () => {
      const next = change(await this.list())
      if (next === undefined) return
      try {
        await mkdir(this.dataDir, { recursive: true })
        await writeFile(this.file, JSON.stringify(next, null, 2), 'utf8')
      }
      catch (err) {
        console.warn(`[dsh-workbench] failed to persist active terminals: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
    // A failed cycle must not poison the chain for later mutations.
    this.mutations = run.catch(() => {})
    return run
  }
}
