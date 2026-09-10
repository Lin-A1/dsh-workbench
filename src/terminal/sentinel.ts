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

export function stripSentinel(text: string, token: string): { text: string; exitCode: number } | undefined {
  if (!TOKEN_CHARSET.test(token)) throw new Error(`sentinel token ${JSON.stringify(token)} is not regex-safe`)
  const re = new RegExp(`\\n?${token}:(\\d+)\\n?`)
  const match = re.exec(text)
  if (match === null) return undefined
  const cleaned = text.slice(0, match.index) + text.slice(match.index + match[0].length)
  return { text: cleaned, exitCode: Number(match[1]) }
}

/**
 * Filter sentinel marks out of the interactive display stream.
 * CRITICAL FOR INTERACTIVE TYPING:
 * Normal keystrokes, letters, spaces, and control sequences must be emitted
 * IMMEDIATELY (zero buffering delay). We only hold back partial matches
 * when the buffer ends with a potential prefix of SENTINEL_MARK.
 */
export function createSentinelLineFilter(): (chunk: string) => string {
  let pending = ''
  return (chunk) => {
    pending += chunk

    // Fast-path: if pending contains no sentinel mark at all
    const sentinelIdx = pending.indexOf(SENTINEL_MARK)
    if (sentinelIdx < 0) {
      // Check if the tail ends with a partial prefix of SENTINEL_MARK (e.g. "_", "__", "__D")
      let safeEnd = pending.length
      const maxPrefix = Math.min(pending.length, SENTINEL_MARK.length - 1)
      for (let len = maxPrefix; len >= 1; len--) {
        if (SENTINEL_MARK.startsWith(pending.slice(pending.length - len))) {
          safeEnd = pending.length - len
          break
        }
      }
      const out = pending.slice(0, safeEnd)
      pending = pending.slice(safeEnd)
      return out
    }

    // Slow-path: pending has a sentinel mark. Strip complete lines containing the sentinel.
    let out = ''
    for (;;) {
      const nl = pending.indexOf('\n')
      if (nl < 0) break
      const lineWithNl = pending.slice(0, nl + 1)
      pending = pending.slice(nl + 1)
      if (!lineWithNl.includes(SENTINEL_MARK)) {
        out += lineWithNl
      }
    }

    // After stripping sentinel lines, flush any safe trailing text
    if (!pending.includes(SENTINEL_MARK)) {
      let safeEnd = pending.length
      const maxPrefix = Math.min(pending.length, SENTINEL_MARK.length - 1)
      for (let len = maxPrefix; len >= 1; len--) {
        if (SENTINEL_MARK.startsWith(pending.slice(pending.length - len))) {
          safeEnd = pending.length - len
          break
        }
      }
      out += pending.slice(0, safeEnd)
      pending = pending.slice(safeEnd)
    }

    return out
  }
}
