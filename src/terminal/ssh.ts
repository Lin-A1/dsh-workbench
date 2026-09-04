/**
 * ssh2 connection factory for remote workbench terminal sessions.
 * @module dsh-workbench/terminal/ssh
 */

import { readFile } from 'node:fs/promises'
import { Client } from 'ssh2'
import type { ShellChannel, TerminalConnection } from '../types.ts'

export interface SshConnectRequest {
  host: string
  user: string
  port: number
  identityFile?: string
  password?: string
  connectTimeoutMs: number
  cols: number
  rows: number
  keepaliveIntervalMs?: number
}

export async function connectSsh(req: SshConnectRequest): Promise<TerminalConnection> {
  const client = new Client()
  const privateKey = req.identityFile === undefined ? undefined : await readFile(req.identityFile)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy()
      reject(new Error(`ssh connect to ${req.user}@${req.host}:${req.port} timed out after ${req.connectTimeoutMs}ms`))
    }, req.connectTimeoutMs)
    client.once('ready', () => {
      clearTimeout(timer)
      resolve()
    })
    client.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    client.connect({
      host: req.host,
      port: req.port,
      username: req.user,
      ...privateKey !== undefined ? { privateKey } : {},
      ...req.password !== undefined ? { password: req.password } : {},
      ...req.keepaliveIntervalMs ? { keepaliveInterval: Math.max(1, Math.round(req.keepaliveIntervalMs / 1000)) } : {},
      readyTimeout: req.connectTimeoutMs,
    })
  })
  return {
    openShell: () => new Promise<ShellChannel>((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols: req.cols, rows: req.rows }, (error, channel) => {
        if (error) {
          reject(error)
          return
        }
        resolve({
          write: data => channel.write(data),
          close: () => channel.close(),
          resize: (rows, cols) => { channel.setWindow(rows, cols, 0, 0) },
          onData: listener => channel.on('data', (chunk: Buffer) => listener(chunk.toString('utf8'))),
          onClose: listener => channel.once('close', listener),
        })
      })
    }),
    close: () => client.end(),
  }
}
