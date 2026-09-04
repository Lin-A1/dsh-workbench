/**
 * Saved connection profiles for workbench terminals (local and ssh).
 * @module dsh-workbench/terminal/profiles
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TerminalProfile } from '../protocol.ts'

interface StoreFile {
  version: 1
  profiles: TerminalProfile[]
}

const EMPTY_STORE: StoreFile = { version: 1, profiles: [] }

export class ProfileStore {
  private cache: StoreFile | undefined
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return join(this.dataDir, 'profiles.json')
  }

  async list(): Promise<TerminalProfile[]> {
    const store = await this.load()
    return [...store.profiles].sort((a, b) => a.name.localeCompare(b.name))
  }

  async get(name: string): Promise<TerminalProfile | undefined> {
    const store = await this.load()
    return store.profiles.find(profile => profile.name === name)
  }

  async upsert(profile: TerminalProfile): Promise<void> {
    assertValidProfile(profile)
    const store = await this.load()
    const existing = store.profiles.findIndex(entry => entry.name === profile.name)
    if (existing >= 0) store.profiles[existing] = profile
    else store.profiles.push(profile)
    await this.save(store)
  }

  async remove(name: string): Promise<boolean> {
    const store = await this.load()
    const before = store.profiles.length
    store.profiles = store.profiles.filter(profile => profile.name !== name)
    if (store.profiles.length === before) return false
    await this.save(store)
    return true
  }

  private async load(): Promise<StoreFile> {
    if (this.cache !== undefined) return this.cache
    try {
      const content = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(content) as StoreFile
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) throw new Error('malformed store')
      this.cache = { version: 1, profiles: parsed.profiles.filter(p => isPlainProfile(p)) }
    }
    catch {
      this.cache = { ...EMPTY_STORE, profiles: [] }
    }
    return this.cache
  }

  private async save(store: StoreFile): Promise<void> {
    this.cache = store
    const previous = this.saving
    this.saving = (async () => {
      await previous
      await mkdir(this.dataDir, { recursive: true })
      const tmp = `${this.file}.tmp-${Date.now()}`
      await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
      await rename(tmp, this.file)
    })()
    await this.saving
  }
}

function assertValidProfile(profile: TerminalProfile): void {
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    throw new Error('profile name must be a non-empty string')
  }
  if (profile.kind === 'ssh') {
    if (typeof profile.host !== 'string' || profile.host.length === 0) {
      throw new Error(`ssh profile ${JSON.stringify(profile.name)} requires a non-empty host`)
    }
    if (typeof profile.user !== 'string' || profile.user.length === 0) {
      throw new Error(`ssh profile ${JSON.stringify(profile.name)} requires a non-empty user`)
    }
  }
}

function isPlainProfile(value: unknown): value is TerminalProfile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TerminalProfile>
  return typeof candidate.name === 'string' && (candidate.kind === 'local' || candidate.kind === 'ssh')
}
