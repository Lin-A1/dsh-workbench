/**
 * Local shell process connection factory for workbench terminal sessions.
 * Spawns native shell (Git Bash / PowerShell on Windows, default SHELL on POSIX)
 * scoped to the active workspace directory, with strict UTF-8 stream decoding.
 * @module dsh-workbench/terminal/local
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
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
    // Probe standard Git Bash installation paths on Windows
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Git\\bin\\bash.exe`,
      `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Git\\bin\\bash.exe`,
      `${process.env.LocalAppData || ''}\\Programs\\Git\\bin\\bash.exe`,
    ]
    for (const p of candidates) {
      if (p && existsSync(p)) {
        return { file: p, args: ['--login', '-i'] }
      }
    }
    // Fallback to powershell with UTF-8 encoding command
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8'],
    }
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
            LANG: 'zh_CN.UTF-8',
            LC_ALL: 'zh_CN.UTF-8',
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
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

      // Use StringDecoder to prevent chunk-boundary multi-byte truncation mojibake
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      activeProc.stdout.on('data', (data: Buffer) => {
        const text = stdoutDecoder.write(data)
        if (text) {
          for (const l of listeners) l(text)
        }
      })

      activeProc.stderr.on('data', (data: Buffer) => {
        const text = stderrDecoder.write(data)
        if (text) {
          for (const l of listeners) l(text)
        }
      })

      activeProc.on('close', () => {
        const remaining = stdoutDecoder.end() + stderrDecoder.end()
        if (remaining) {
          for (const l of listeners) l(remaining)
        }
        for (const l of closeListeners) l()
      })

      activeProc.on('error', (err) => {
        const msg = `\r\n[process error: ${err.message}]\r\n`
        for (const l of listeners) l(msg)
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
            // ignore
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
