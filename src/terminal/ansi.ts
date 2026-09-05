/**
 * ANSI/control-character sanitizer for model-facing terminal transcripts.
 * TUI programs (Claude Code, progress bars, editors) redraw with cursor
 * motion, elide codes, and carriage-return overwrites; rendered in a terminal
 * this looks fine, but dropped raw into a model context it explodes into
 * thousands of noise tokens. `sanitizeTerminalText` produces a "cooked"
 * transcript: escape sequences removed, overwrites resolved to their final
 * text, backspaces applied, blank-line runs collapsed.
 * @module dsh-workbench/terminal/ansi
 */

const ESC = 0x1b
const BEL = 0x07

/** Remove ESC sequences: CSI, OSC, charset designations, and two-byte escapes. */
export function stripAnsiSequences(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    if (text.charCodeAt(i) !== ESC) {
      out += text[i]
      i += 1
      continue
    }
    const next = text.charCodeAt(i + 1)
    if (next === 0x5b) {
      // CSI: parameter bytes then a final byte in 0x40–0x7E
      let j = i + 2
      while (j < n) {
        const c = text.charCodeAt(j)
        if (c >= 0x40 && c <= 0x7e) break
        j += 1
      }
      i = j + 1
      continue
    }
    if (next === 0x5d) {
      // OSC: terminated by BEL or ST (ESC \)
      let j = i + 2
      while (j < n) {
        if (text.charCodeAt(j) === BEL) {
          j += 1
          break
        }
        if (text.charCodeAt(j) === ESC && text.charCodeAt(j + 1) === 0x5c) {
          j += 2
          break
        }
        j += 1
      }
      i = j
      continue
    }
    if (next === 0x28 || next === 0x29 || next === 0x23) {
      i += 3 // charset designation: ESC ( X
      continue
    }
    if (Number.isNaN(next)) {
      i += 1 // lone trailing ESC
      continue
    }
    i += 2 // generic two-byte escape (ESC 7, ESC M, …)
  }
  return out
}

/** Resolve carriage-return overwrites inside one line: each \r restarts the column, tail of a longer predecessor survives. */
function resolveCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line
  const segments = line.split('\r')
  let acc = segments[0]
  for (let k = 1; k < segments.length; k++) {
    const seg = segments[k]
    acc = seg.length >= acc.length ? seg : seg + acc.slice(seg.length)
  }
  return acc
}

/** Apply backspace erasure (progress counters like `10\b\b100%`). */
function applyBackspaces(text: string): string {
  if (!text.includes('\x08')) return text
  const chars: string[] = []
  for (const ch of text) {
    if (ch === '\x08') chars.pop()
    else chars.push(ch)
  }
  return chars.join('')
}

/**
 * Cook one raw terminal chunk into model-readable text: strip escapes,
 * resolve per-line overwrites and backspaces, trim trailing blanks, and
 * collapse blank-line runs that TUI redraws leave behind.
 */
export function sanitizeTerminalText(text: string, maxBlankRun = 2): string {
  const stripped = stripAnsiSequences(text)
  const lines = stripped.split('\n').map((line) => {
    return applyBackspaces(resolveCarriageReturns(line)).replace(/[ \t]+$/g, '')
  })
  const out: string[] = []
  let blank = 0
  for (const line of lines) {
    if (line === '') {
      blank += 1
      if (blank > maxBlankRun) continue
    }
    else {
      blank = 0
    }
    out.push(line)
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}
