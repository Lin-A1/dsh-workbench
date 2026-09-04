/**
 * Command boundary sentinel protocol & display stream filtering.
 * @module dsh-workbench/terminal/sentinel
 */

const TOKEN_CHARSET = /^[A-Za-z0-9_]+$/
export const SENTINEL_MARK = '__DSHWB_'

export function createDoneToken(scope: string, seq: number): string {
  const safeScope = scope.replace(/[^A-Za-z0-9]/g, '_')
  const rand = Math.random().toString(36).slice(2, 10)
  return `${SENTINEL_MARK}DONE_${safeScope}_${seq}_${rand}__`
}

export function createReadyToken(scope: string): string {
  const safeScope = scope.replace(/[^A-Za-z0-9]/g, '_')
  const rand = Math.random().toString(36).slice(2, 10)
  return `${SENTINEL_MARK}READY_${safeScope}_${rand}__`
}

export function stripSentinel(text: string, token: string): { text: string; exitCode: number } | undefined {
  if (!TOKEN_CHARSET.test(token)) throw new Error(`sentinel token ${JSON.stringify(token)} is not regex-safe`)
  const re = new RegExp(`\\n?${token}:(\\d+)\\n?`)
  const match = re.exec(text)
  if (match === null) return undefined
  const cleaned = text.slice(0, match.index) + text.slice(match.index + match[0].length)
  return { text: cleaned, exitCode: Number(match[1]) }
}

export function stripMarkerLines(text: string, token: string): string {
  return text
    .split('\n')
    .filter(line => !line.includes(token))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

export function createSentinelLineFilter(): (chunk: string) => string {
  let pending = ''
  return (chunk) => {
    pending += chunk
    let out = ''
    for (;;) {
      const nl = pending.indexOf('\n')
      if (nl < 0) break
      const line = pending.slice(0, nl)
      pending = pending.slice(nl + 1)
      if (!line.includes(SENTINEL_MARK)) out += `${line}\n`
    }
    for (;;) {
      const cr = pending.indexOf('\r')
      if (cr < 0) break
      const segment = pending.slice(0, cr)
      pending = pending.slice(cr + 1)
      if (!segment.includes(SENTINEL_MARK)) out += `${segment}\r`
    }
    if (pending.length > 65536) {
      out += pending
      pending = ''
    }
    return out
  }
}
