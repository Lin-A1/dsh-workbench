/**
 * Git worktree panel: branch header, changed-path list, and a diff viewer.
 *
 * The panel subscribes to the `git` channel itself rather than routing diffs
 * through the tab strip, so diff state exists only while the panel is on
 * screen and the strip keeps rendering on list changes alone.
 * @module dsh-workbench/client/GitPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatusView } from '../types.ts'
import { GitBranchIcon, ReloadIcon } from './icons.tsx'
import { workbenchClient } from './ws.ts'

export interface GitPanelProps {
  sessionId?: string
  /** True while the Git tab is the selected one; drives the initial read. */
  active: boolean
}

/** Index/worktree letter → the tone the badge paints it in. */
function toneOf(x: string, y: string): string {
  if (x === '?' && y === '?') return 'untracked'
  const letters = `${x}${y}`
  if (letters.includes('D')) return 'deleted'
  if (letters.includes('A')) return 'added'
  if (letters.includes('R') || letters.includes('C')) return 'renamed'
  if (letters.includes('U')) return 'conflict'
  return 'modified'
}

function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity ') || line.startsWith('rename ')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

export function GitPanel({ sessionId, active }: GitPanelProps): JSX.Element {
  const [status, setStatus] = useState<GitStatusView | null>(null)
  const [statusError, setStatusError] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [diff, setDiff] = useState('')
  const [diffError, setDiffError] = useState<string | undefined>(undefined)
  const [diffPending, setDiffPending] = useState(false)
  /** The path the in-flight diff request asked for; frames for anything else
   *  are the answer to a click the user has already moved past. */
  const pendingPath = useRef<string | undefined>(undefined)

  const refresh = useCallback((): void => {
    workbenchClient.send({ channel: 'git', type: 'status', sessionId })
  }, [sessionId])

  const openDiff = useCallback((path: string): void => {
    setSelected(path)
    setDiffPending(true)
    setDiffError(undefined)
    pendingPath.current = path
    workbenchClient.send({ channel: 'git', type: 'diff', sessionId, path })
  }, [sessionId])

  useEffect(() => workbenchClient.onFrame((frame) => {
    if (frame.channel !== 'git') return
    if (frame.type === 'status') {
      setStatus(frame.status)
      setStatusError(frame.error)
      setLoaded(true)
      // A path that left the worktree cannot keep showing a stale diff.
      setSelected(current => (current !== undefined && frame.status !== null && !frame.status.files.some(f => f.path === current) ? undefined : current))
      return
    }
    if (frame.type === 'diff') {
      if (pendingPath.current !== undefined && frame.path !== pendingPath.current) return
      pendingPath.current = undefined
      setDiff(frame.diff)
      setDiffError(frame.error)
      setDiffPending(false)
    }
  }), [])

  // First read happens when the tab becomes visible, and only then: a session
  // switch while the tab is hidden must not spend a `git status` on a
  // workspace nobody is looking at.
  useEffect(() => {
    if (!active) return
    refresh()
  }, [active, refresh])

  const files = status?.files ?? []

  return (
    <div className="wb-git-root">
      <div className="wb-git-head">
        <span className="wb-git-branch" title={status?.branch ?? undefined}>
          <GitBranchIcon size={12} />
          <span className="wb-git-branch-name">{status?.branch ?? '—'}</span>
        </span>
        {status !== null && (status.ahead > 0 || status.behind > 0) ? (
          <span className="wb-git-tracking">
            {status.ahead > 0 ? <span className="wb-git-ahead">↑{status.ahead}</span> : null}
            {status.behind > 0 ? <span className="wb-git-behind">↓{status.behind}</span> : null}
          </span>
        ) : null}
        {status !== null ? (
          <span className="wb-git-numstat">
            <span className="wb-git-add">+{status.additions}</span>
            <span className="wb-git-del">−{status.deletions}</span>
            <span className="wb-git-count">{files.length} 项变更</span>
          </span>
        ) : null}
        <button type="button" className="wb-icon-btn wb-git-refresh" onClick={refresh} title="刷新 Git 状态">
          <ReloadIcon size={12} />
        </button>
      </div>

      {statusError !== undefined ? (
        <p className="wb-git-notice wb-git-notice-error">{statusError}</p>
      ) : null}

      {!loaded ? (
        <p className="wb-git-notice">正在读取工作区状态…</p>
      ) : status === null ? (
        <div className="wb-git-empty">
          <p className="wb-empty-title">这个目录不是 Git 仓库</p>
          <p className="wb-hint">在此会话的工作区里 <code>git init</code> 之后，分支、变更与 Diff 会显示在这里。</p>
        </div>
      ) : files.length === 0 ? (
        <div className="wb-git-empty">
          <p className="wb-empty-title">工作区干净</p>
          <p className="wb-hint">分支 {status.branch ?? '—'} 上没有未提交的改动。</p>
        </div>
      ) : (
        <div className="wb-git-split">
          <div className="wb-git-files">
            {files.map(file => (
              <button
                key={file.path}
                type="button"
                className={`wb-git-file${selected === file.path ? ' active' : ''}`}
                onClick={() => openDiff(file.path)}
                title={file.path}
              >
                <span className={`wb-git-badge tone-${toneOf(file.x, file.y)}`}>{(file.x + file.y).trim() || 'M'}</span>
                <span className="wb-git-path">{file.path}</span>
              </button>
            ))}
          </div>

          <div className="wb-git-diff">
            {selected === undefined ? (
              <p className="wb-git-notice">选择上方任意文件查看 Diff</p>
            ) : diffPending ? (
              <p className="wb-git-notice">正在读取 {selected} 的 Diff…</p>
            ) : diffError !== undefined ? (
              <p className="wb-git-notice wb-git-notice-error">{diffError}</p>
            ) : diff.trim().length === 0 ? (
              <p className="wb-git-notice">没有可显示的差异</p>
            ) : (
              <>
                <div className="wb-git-diff-path" title={selected}>{selected}</div>
                <pre className="wb-git-diff-body">
                  {diff.split('\n').map((line, i) => (
                    <div key={i} className={`wb-git-diff-line ${diffLineClass(line)}`}>{line.length === 0 ? ' ' : line}</div>
                  ))}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
