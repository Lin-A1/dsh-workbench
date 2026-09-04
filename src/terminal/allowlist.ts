/**
 * Host allowlist matching for outbound SSH connections.
 * @module dsh-workbench/terminal/allowlist
 */

export function hostAllowed(host: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true
  const candidate = host.toLowerCase()
  return allowlist.some((raw) => {
    const entry = raw.toLowerCase()
    if (entry === '*') return true
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2)
      return candidate === suffix || candidate.endsWith(`.${suffix}`)
    }
    return candidate === entry
  })
}
