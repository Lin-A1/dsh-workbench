/**
 * Local shell process connection factory for workbench terminal sessions.
 * Spawns native shell (Git Bash / PowerShell on Windows, default SHELL on POSIX)
 * scoped to the active workspace directory.
 * @module dsh-workbench/terminal/local
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ShellChannel, TerminalConnection } from '../types.ts'

export interface LocalShellRequest {
  cwd?: string
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}

function resolveShellCommand(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // Prefer Git Bash if present, fallback to powershell
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    if (existsSync(gitBash)) {
      return { file: gitBash, args: ['-i'] }
    }
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  const defaultShell = process.env.SHELL || '/bin/bash'
  return { file: existsSync(defaultShell) ? defaultShell : '/bin/sh', args: ['-i'] }
}

export async function connectLocal(req: LocalShellRequest): Promise<TerminalConnection> {
  const { file, args } = resolveShellCommand()
  const cwd = req.cwd && existsSync(req.cwd) ? req.cwd : process.cwd()
  let proc: ChildProcessWithoutNullStreams | undefined

  return {
    openShell: () => new Promise<ShellChannel>((resolve, reject) => {
      try {
        proc = spawn(file, args, {
          cwd,
          env: {
            ...process.env,
            ...req.env,
            TERM: 'xterm-256color',
            COLUMNS: String(req.cols),
            LINES: String(req.rows),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      }
      catch (err) {
        reject(err)
        return
      }

      const activeProc = proc
      const listeners: ((chunk: string) => void)[] = []
      const closeListeners: (() => void)[] = []

      const onData = (data: Buffer) => {
        const text = data.toString('utf8')
        for (const l of listeners) l(text)
      }

      activeProc.stdout.on('data', onData)
      activeProc.stderr.on('data', onData)
      activeProc.on('close', () => {
        for (const l of closeListeners) l()
      })
      activeProc.on('error', (err) => {
        onData(Buffer.from(`\r\n[process error: ${err.message}]\r\n`))
        for (const l of closeListeners) l()
      })

      resolve({
        write: (data: string) => {
          if (activeProc.stdin.writable) {
            activeProc.stdin.write(data)
          }
        },
        close: () => {
          try {
            activeProc.kill()
          }
          catch {
            // process may already be dead
          }
        },
        onData: (listener) => { listeners.push(listener) },
        onClose: (listener) => { closeListeners.push(listener) },
      })
    }),
    close: () => {
      try {
        proc?.kill()
      }
      catch {
        // ignore
      }
    },
  }
}
