/**
 * Persistent storage for active terminal specifications.
 * Allows local and SSH terminal sessions to survive service restarts:
 * specs are written on open and removed on close; at boot the manager restores
 * un-closed terminals under their original IDs so the journal replay history
 * aligns seamlessly.
 * @module dsh-workbench/terminal/store
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
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

  async save(spec: PersistedTerminalSpec): Promise<void> {
    const list = await this.list()
    const index = list.findIndex(item => item.id === spec.id)
    if (index >= 0) {
      list[index] = spec
    }
    else {
      list.push(spec)
    }
    await this.writeAll(list)
  }

  async remove(id: string): Promise<void> {
    const list = await this.list()
    const filtered = list.filter(item => item.id !== id)
    if (filtered.length !== list.length) {
      await this.writeAll(filtered)
    }
  }

  private async writeAll(list: PersistedTerminalSpec[]): Promise<void> {
    try {
      await mkdir(this.dataDir, { recursive: true })
      await writeFile(this.file, JSON.stringify(list, null, 2), 'utf8')
    }
    catch (err) {
      console.warn(`[dsh-workbench] failed to persist active terminals: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
