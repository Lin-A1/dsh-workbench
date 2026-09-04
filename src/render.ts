/**
 * Model-facing output rendering and byte-bounding helpers.
 * @module dsh-workbench/render
 */

import type { ActivityEntry, ReadResult, SendResult, TerminalSnapshot } from './types.ts'

const TRUNCATED = '\n[output truncated]'
const RENDER_ACTIVITY_LIMIT = 80

export function boundText(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= maxBytes) return text
  const markerBytes = new TextEncoder().encode(TRUNCATED).byteLength
  if (markerBytes >= maxBytes) return TRUNCATED.slice(0, maxBytes)
  const head = new TextDecoder().decode(bytes.subarray(0, maxBytes - markerBytes), { stream: true })
  return `${head}${TRUNCATED}`
}

function statusText(status: TerminalSnapshot['status']): string {
  return status.kind === 'running'
    ? 'running'
    : `exited code=${status.exitCode ?? 'null'} signal=${status.signal ?? 'null'}`
}

export function renderOpen(snapshot: TerminalSnapshot, motd: string, maxBytes: number): string {
  const name = snapshot.name ? ` (${snapshot.name})` : ''
  const target = snapshot.kind === 'ssh' ? `[ssh: ${snapshot.user}@${snapshot.host}:${snapshot.port}]` : `[local: ${snapshot.cwd || 'default'}]`
  const banner = motd || '(started without banner)'
  return boundText(`started workbench terminal ${snapshot.terminalId}${name} ${target}\n${banner}`, maxBytes)
}

export function renderSend(result: SendResult, maxBytes: number): string {
  const output = result.output || '(no new output)'
  const exit = result.exitCode === null ? '' : `\n[exit code: ${result.exitCode}]`
  const truncated = result.truncated ? TRUNCATED : ''
  return boundText(`${output}\n[wait: ${result.waitReason}]${exit}\n[session: ${result.status}]${truncated}`, maxBytes)
}

function activityLine(entry: ActivityEntry): string {
  const time = new Date(entry.at).toTimeString().slice(0, 8)
  const text = entry.text.length <= RENDER_ACTIVITY_LIMIT ? entry.text : `${entry.text.slice(0, RENDER_ACTIVITY_LIMIT)}…`
  return `[activity] ${entry.source}: ${text.replace(/\n+/g, ' ⏎ ')} (${time})`
}

export function renderRead(result: ReadResult, maxBytes: number, recentActivity?: readonly ActivityEntry[]): string {
  const output = result.text || '(no retained output)'
  const truncated = result.truncated ? TRUNCATED : ''
  const activity = recentActivity && recentActivity.length > 0
    ? `\n${recentActivity.map(activityLine).join('\n')}`
    : ''
  return boundText(`${output}\n[lines: ${result.lineBegin}-${result.lineEnd} of ${result.totalLines}]${activity}${truncated}`, maxBytes)
}

export function renderList(
  terminals: readonly (TerminalSnapshot & { unreadBytes?: number; recentActivity?: readonly ActivityEntry[] })[],
  maxBytes: number,
): string {
  if (terminals.length === 0) return '(no active workbench terminals)'
  const text = terminals.map((t) => {
    const name = t.name ? ` (${t.name})` : ''
    const target = t.kind === 'ssh' ? `[ssh: ${t.user}@${t.host}:${t.port}]` : `[local: ${t.cwd || 'default'}]`
    const unread = t.unreadBytes && t.unreadBytes > 0 ? ` [unread ${t.unreadBytes}B]` : ''
    const last = t.recentActivity?.[t.recentActivity.length - 1]
    const act = last ? `\n  ${activityLine(last)}` : ''
    return `${t.terminalId}${name} ${target} ${statusText(t.status)}${unread}${act}`
  }).join('\n')
  return boundText(text, maxBytes)
}
