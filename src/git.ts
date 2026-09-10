/**
 * Read-only Git worktree inspection for the collaborative Git panel.
 *
 * Every invocation is an `execFile` argument vector, never a shell string, so
 * a branch or path carrying shell metacharacters stays data. A directory that
 * is not a repository, is enormous, or is mid-rebase answers with `null` or an
 * error string — it never throws into the gateway loop.
 *
 * `GIT_OPTIONAL_LOCKS=0` keeps these reads from refreshing the index behind
 * the human's own `git` commands, and the pager/credential-prompt variables
 * are pinned so nothing here can block waiting on a terminal that is not
 * there.
 * @module dsh-workbench/git
 */

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitFileChange, GitStatusView } from './types.ts'

const run = promisify(execFile)

const GIT_TIMEOUT_MS = 8_000
const GIT_MAX_BUFFER = 4 * 1024 * 1024
/** Diffs are for reading, not for archiving: past this a file gets a notice. */
const MAX_DIFF_BYTES = 200 * 1024
/** Untracked files are synthesized from their content, with a tighter cap. */
const MAX_UNTRACKED_BYTES = 512 * 1024
const MAX_FILE_COUNT = 500

interface GitRun {
  ok: boolean
  stdout: string
  stderr: string
  message?: string
}

async function git(cwd: string, args: readonly string[]): Promise<GitRun> {
  try {
    const { stdout, stderr } = await run('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
      },
    })
    return { ok: true, stdout, stderr }
  }
  catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      message: (err.stderr || err.message || String(error)).trim(),
    }
  }
}

/**
 * `git status --porcelain=v1 --branch` header, minus the `## `.
 * Shapes seen in the wild: `main`, `main...origin/main [ahead 1, behind 2]`,
 * `No commits yet on main`, `HEAD (no branch)`.
 */
function parseBranchHeader(header: string): { ref: string; ahead: number; behind: number } {
  const body = header.startsWith('## ') ? header.slice(3) : header
  const bracket = body.indexOf(' [')
  const refPart = (bracket < 0 ? body : body.slice(0, bracket)).trim()
  let ahead = 0
  let behind = 0
  if (bracket >= 0) {
    const counts = body.slice(bracket)
    ahead = Number.parseInt(/ahead (\d+)/.exec(counts)?.[1] ?? '0', 10) || 0
    behind = Number.parseInt(/behind (\d+)/.exec(counts)?.[1] ?? '0', 10) || 0
  }
  // `main...origin/main` — the local side is what the panel shows.
  const ref = refPart.split('...')[0].trim()
  if (ref.startsWith('No commits yet on ')) return { ref: ref.slice('No commits yet on '.length), ahead, behind }
  return { ref, ahead, behind }
}

/**
 * Split one `--porcelain=v1 -z` stream into entries. Records are NUL-separated;
 * a rename or copy spends two records, new path then original (the reverse of
 * the non-`-z` `a -> b` form).
 */
function parsePorcelainEntries(stream: string): GitFileChange[] {
  const tokens = stream.split('\0')
  const files: GitFileChange[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    const x = token[0]
    const y = token[1]
    const path = token.slice(3)
    if (x === 'R' || x === 'C') {
      const original = tokens[++i]
      files.push({ x, y, path: original === undefined ? path : `${path} ← ${original}` })
      continue
    }
    files.push({ x, y, path })
    if (files.length >= MAX_FILE_COUNT) break
  }
  return files
}

/** Sum `--numstat` additions and deletions. Binary files report `-`. */
function sumNumstat(text: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    const [a, d] = line.split('\t')
    const added = Number.parseInt(a ?? '', 10)
    const deleted = Number.parseInt(d ?? '', 10)
    if (Number.isFinite(added)) additions += added
    if (Number.isFinite(deleted)) deletions += deleted
  }
  return { additions, deletions }
}

/**
 * Snapshot the worktree for the Git panel.
 * @param cwd - directory inside the repository to inspect.
 * @returns the view, or `null` when `cwd` is not inside a Git worktree.
 * @throws never — a failing git command is reported through `GitRun`.
 */
export async function readGitStatus(cwd: string): Promise<{ view: GitStatusView | null; error?: string }> {
  const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'])
  if (!status.ok) {
    // "not a git repository" is an answer, not a failure: the panel says so
    // instead of showing an error banner for a plain directory.
    if (/not a git repository|not a working tree/i.test(status.message ?? '')) return { view: null }
    return { view: null, error: status.message }
  }

  const tokens = status.stdout.split('\0')
  const header = tokens[0] ?? ''
  const { ref, ahead, behind } = parseBranchHeader(header)
  const files = parsePorcelainEntries(status.stdout.slice(header.length + 1) + '\0')

  let branch = ref
  if (ref === 'HEAD (no branch)') {
    const sha = await git(cwd, ['rev-parse', '--short', 'HEAD'])
    branch = sha.ok ? `detached@${sha.stdout.trim()}` : 'detached HEAD'
  }

  // One `diff HEAD` covers staged and unstaged tracked edits. It fails only in
  // a repository with no commit yet, where the index alone is the difference.
  const numstat = await git(cwd, ['diff', 'HEAD', '--numstat'])
  const { additions, deletions } = numstat.ok
    ? sumNumstat(numstat.stdout)
    : sumNumstat((await git(cwd, ['diff', '--cached', '--numstat'])).stdout)

  return { view: { at: Date.now(), branch, ahead, behind, additions, deletions, files } }
}

/**
 * Render an untracked file as the diff Git would show for a new file.
 *
 * The output is real unified-diff shape — `diff --git`, `new file mode`, a
 * `/dev/null` old side, and a genuine `@@ -0,0 +1,N @@` header — rather than a
 * home-made marker line. The panel then parses one format for every case, and
 * a reader who knows diffs sees what they expect.
 */
async function synthesizeUntrackedDiff(cwd: string, path: string): Promise<string> {
  const full = join(cwd, path)
  try {
    const info = await stat(full)
    if (!info.isFile()) return `[${path} is not a regular file]\n`
    if (info.size > MAX_UNTRACKED_BYTES) {
      return `[${path} is ${Math.round(info.size / 1024)} KB — too large to render]\n`
    }
  }
  catch (error) {
    return `[${error instanceof Error ? error.message : String(error)}]\n`
  }
  const text = await readFile(full, 'utf8').catch(() => undefined)
  if (text === undefined) return `[${path} could not be read as text]\n`
  // A file ending in a newline has no trailing empty line of its own.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const lines = body.split('\n')
  const header = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ].join('\n')
  return `${header}\n${lines.map(line => `+${line}`).join('\n')}\n`
}

/**
 * Unified diff for one path, against HEAD so staged and unstaged edits are
 * shown together. Untracked paths have no diff, so their content is rendered
 * as additions instead — the panel shows something true for every row.
 * @param cwd - repository worktree.
 * @param path - repository-relative path, exactly as `git status` reported it.
 */
export async function readGitDiff(cwd: string, path: string): Promise<{ diff: string; error?: string }> {
  const result = await git(cwd, ['diff', 'HEAD', '--no-color', '--', path])
  if (!result.ok) return { diff: '', error: result.message }
  if (result.stdout.trim().length > 0) return { diff: boundDiff(result.stdout) }
  const synthesized = await synthesizeUntrackedDiff(cwd, path)
  return { diff: boundDiff(synthesized) }
}

function boundDiff(text: string): string {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= MAX_DIFF_BYTES) return text
  const head = Buffer.from(text, 'utf8').subarray(0, MAX_DIFF_BYTES).toString('utf8')
  // A cut mid-codepoint would leave a replacement char; drop the torn tail.
  return `${head.replace(/\uFFFD+$/, '')}\n[diff truncated at ${Math.round(MAX_DIFF_BYTES / 1024)} KB of ${Math.round(bytes / 1024)} KB]\n`
}
