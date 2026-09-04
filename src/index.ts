/**
 * Collaborative workbench plugin for DeepSeek Harness.
 * Provides session-attached multi-tab terminal, git, and browser integration.
 * @module dsh-workbench
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { registerWorkbenchGateway } from './gateway.ts'
import { renderList, renderOpen, renderRead, renderSend } from './render.ts'
import { JournalStore } from './terminal/journal.ts'
import { WorkbenchTerminalManager } from './terminal/manager.ts'
import { ProfileStore } from './terminal/profiles.ts'
import type { TerminalKind } from './types.ts'

export const name = 'dsh-workbench'
export const inject = ['tools', 'webServer', 'systemPrompt']

export const DEFAULT_DATA_DIR = join(homedir(), '.dsh-workbench')

export interface Config {
  allowlist?: string[]
  maxSessions?: number
  defaultPort?: number
  connectTimeoutMs?: number
  idleMs?: number
  sendTimeoutMs?: number
  maxScrollbackBytes?: number
  maxResultBytes?: number
  keepaliveIntervalMs?: number
  dataDir?: string
  trustedHosts?: string[]
}

export const Config: z<Config> = z.object({
  allowlist: z.array(z.string()).default([]),
  maxSessions: z.number().step(1).min(1).max(1024).default(16),
  defaultPort: z.number().step(1).min(1).max(65535).default(22),
  connectTimeoutMs: z.number().step(1).min(1).default(15000),
  idleMs: z.number().step(1).min(1).default(800),
  sendTimeoutMs: z.number().step(1).min(1).default(30000),
  maxScrollbackBytes: z.number().step(1).min(1024).default(1048576),
  maxResultBytes: z.number().step(1).min(256).default(131072),
  keepaliveIntervalMs: z.number().step(1).min(0).default(15000),
  dataDir: z.string().default(DEFAULT_DATA_DIR),
  trustedHosts: z.array(z.string()).default([]),
})

export interface ResolvedConfig {
  allowlist: readonly string[]
  maxSessions: number
  defaultPort: number
  connectTimeoutMs: number
  idleMs: number
  sendTimeoutMs: number
  maxScrollbackBytes: number
  maxResultBytes: number
  keepaliveIntervalMs: number
  dataDir: string
  trustedHosts: readonly string[]
}

export function resolveConfig(config: Config): ResolvedConfig {
  return {
    allowlist: config.allowlist ?? [],
    maxSessions: config.maxSessions ?? 16,
    defaultPort: config.defaultPort ?? 22,
    connectTimeoutMs: config.connectTimeoutMs ?? 15000,
    idleMs: config.idleMs ?? 800,
    sendTimeoutMs: config.sendTimeoutMs ?? 30000,
    maxScrollbackBytes: config.maxScrollbackBytes ?? 1048576,
    maxResultBytes: config.maxResultBytes ?? 131072,
    keepaliveIntervalMs: config.keepaliveIntervalMs ?? 15000,
    dataDir: config.dataDir && config.dataDir !== '' ? config.dataDir : DEFAULT_DATA_DIR,
    trustedHosts: config.trustedHosts ?? [],
  }
}

const TERMINAL_STATUS_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'running' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'exited' },
        exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
        signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
  ],
} as const

const TERMINAL_SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    terminalId: { type: 'string', required: true },
    name: { type: 'string' },
    kind: { type: 'string', required: true, enum: ['local', 'ssh'] },
    sessionId: { type: 'string' },
    cwd: { type: 'string' },
    host: { type: 'string' },
    user: { type: 'string' },
    port: { type: 'integer' },
    status: { ...TERMINAL_STATUS_SCHEMA, required: true },
  },
} as const

const ACTIVITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true, enum: ['human', 'model'] },
    text: { type: 'string', required: true },
    at: { type: 'integer', required: true },
  },
} as const

interface OpenArgs {
  kind?: 'local' | 'ssh'
  name?: string
  cwd?: string
  host?: string
  user?: string
  port?: number
  identityFile?: string
  password?: string
  profileName?: string
  echo?: boolean
}

interface SendArgs {
  terminalId: string
  data: string
  submit?: boolean
  idleMs?: number
  timeoutMs?: number
}

interface ReadArgs {
  terminalId: string
  offset?: number
  count?: number
}

interface CloseArgs {
  terminalId: string
}

function rawContentText(result: ToolResult): string | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  return block?.type === 'text' ? block.text : undefined
}

/** Ensure object has no undefined keys so it satisfies harness lossless JSON validation. */
function cleanLossless<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function createTools(
  manager: WorkbenchTerminalManager,
  config: ResolvedConfig,
  profiles?: ProfileStore,
): ToolDefinition[] {
  const maxResultBytes = config.maxResultBytes

  return [
    defineTool({
      name: 'workbench_terminal_open',
      description: 'Open a collaborative interactive shell terminal (local or SSH) attached to the workbench. The human operator can watch and type in this terminal in real-time. Use kind="local" (default) to execute in the workspace directory, or kind="ssh" for remote servers.',
      parameters: {
        kind: { type: 'string', enum: ['local', 'ssh'], description: 'Terminal type: "local" (default) or "ssh".' },
        name: { type: 'string', description: 'Display name for the terminal tab.' },
        cwd: { type: 'string', description: 'Working directory for local shell.' },
        host: { type: 'string', description: 'Remote host for SSH.' },
        user: { type: 'string', description: 'Remote user for SSH.' },
        port: { type: 'number', description: 'Port for SSH (default 22).' },
        identityFile: { type: 'string', description: 'Path to private key for SSH.' },
        password: { type: 'string', description: 'Password for SSH.' },
        profileName: { type: 'string', description: 'Reference a saved profile configuration.' },
        echo: { type: 'boolean', description: 'PTY echo setting.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...TERMINAL_SNAPSHOT_SCHEMA.properties,
            motd: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderOpen(value, value.motd, maxResultBytes) }],
      },
      async execute(args: OpenArgs, exec) {
        let base = args.profileName && profiles ? await profiles.get(args.profileName) : undefined
        const kind: TerminalKind = args.kind ?? base?.kind ?? (args.host ? 'ssh' : 'local')

        const { snapshot, motd } = await manager.open({
          kind,
          name: args.name ?? base?.name,
          cwd: args.cwd ?? base?.cwd,
          host: args.host ?? base?.host,
          user: args.user ?? base?.user,
          port: args.port ?? base?.port,
          identityFile: args.identityFile ?? base?.identityFile,
          password: args.password,
          echo: args.echo ?? base?.echo,
        })

        if (exec.signal.aborted) {
          await manager.close(snapshot.terminalId)
          throw new Error('workbench terminal open aborted')
        }
        return cleanLossless({ ...snapshot, motd })
      },
      presentCall: args => ({
        card: 'generic',
        title: `Open Workbench Terminal (${args.kind ?? 'local'})`,
        kind: 'execute',
      }),
    }),

    defineTool({
      name: 'workbench_terminal_send',
      description: 'Send input to an active collaborative workbench terminal. The human operator may also type in this terminal concurrently; check workbench_terminal_list before sending to catch up on human inputs.',
      parameters: {
        terminalId: { type: 'string', required: true, description: 'Terminal id.' },
        data: { type: 'string', required: true, description: 'Text / commands to execute.' },
        submit: { type: 'boolean', description: 'Submit Enter after text (default true).' },
        idleMs: { type: 'number', description: 'Silence wait window in ms.' },
        timeoutMs: { type: 'number', description: 'Timeout in ms.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            output: { type: 'string', required: true },
            waitReason: { type: 'string', required: true, enum: ['command_done', 'inferred_idle', 'timeout', 'session_exit'] },
            exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
            status: { type: 'string', required: true, enum: ['running', 'exited'] },
            truncated: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderSend(value, maxResultBytes) }],
        presentationMeta: (_args, value) => ({
          waitReason: value.waitReason,
          exitCode: value.exitCode,
          status: value.status,
          truncated: value.truncated,
        }),
      },
      async execute(args: SendArgs, exec) {
        const session = manager.get(args.terminalId)
        return await session.send({
          data: args.data,
          submit: args.submit ?? true,
          idleMs: args.idleMs ?? config.idleMs,
          timeoutMs: args.timeoutMs ?? config.sendTimeoutMs,
          signal: exec.signal,
        })
      },
      presentCall: args => ({ card: 'terminal', title: args.data || '(send)', description: args.terminalId }),
      presentResult(_args, result) {
        if (result.isError) return undefined
        const raw = rawContentText(result)
        return raw === undefined ? undefined : { card: 'terminal' as const, output: raw }
      },
    }),

    defineTool({
      name: 'workbench_terminal_read',
      description: 'Read retained output and recent human/model activity from a collaborative workbench terminal.',
      parameters: {
        terminalId: { type: 'string', required: true, description: 'Terminal id.' },
        offset: { type: 'number', description: 'Lines to skip from newest end (default 0).' },
        count: { type: 'number', description: 'Max lines to return (default 500).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
            totalLines: { type: 'integer', required: true },
            lineBegin: { type: 'integer', required: true },
            lineEnd: { type: 'integer', required: true },
            truncated: { type: 'boolean', required: true },
            recentActivity: { type: 'array', items: ACTIVITY_SCHEMA },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderRead(value, maxResultBytes, value.recentActivity) }],
      },
      execute(args: ReadArgs) {
        const session = manager.get(args.terminalId)
        const res = session.read(args.offset ?? 0, args.count ?? 500)
        return Promise.resolve(cleanLossless({
          ...res,
          recentActivity: session.recentActivity(5),
        }))
      },
      isConcurrencySafe: () => true,
      presentCall: args => ({ card: 'generic', title: `Read Terminal ${args.terminalId}`, kind: 'read' }),
    }),

    defineTool({
      name: 'workbench_terminal_list',
      description: 'List active collaborative terminals with unread output count and recent human activity.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ...TERMINAL_SNAPSHOT_SCHEMA.properties,
              unreadBytes: { type: 'integer', required: true },
              recentActivity: { type: 'array', items: ACTIVITY_SCHEMA },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderList(value, maxResultBytes) }],
      },
      execute() {
        const list = manager.listDetailed(5)
        // Strip cols/rows and remove undefineds so it passes schema and lossless JSON validation
        return Promise.resolve(cleanLossless(list.map(({ cols: _c, rows: _r, ...item }) => item)))
      },
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: 'List Workbench Terminals', kind: 'read' }),
    }),

    defineTool({
      name: 'workbench_terminal_close',
      description: 'Close an active workbench terminal.',
      parameters: {
        terminalId: { type: 'string', required: true, description: 'Terminal id.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            terminalId: { type: 'string', required: true },
            outcome: { type: 'string', required: true, enum: ['closed', 'already-closing'] },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `closed workbench terminal ${value.terminalId} (${value.outcome})`,
        }],
      },
      async execute(args: CloseArgs) {
        const outcome = await manager.close(args.terminalId)
        return { terminalId: args.terminalId, outcome }
      },
      presentCall: args => ({ card: 'generic', title: `Close Terminal ${args.terminalId}`, kind: 'delete' }),
    }),
  ]
}

interface SystemPromptFace {
  section(section: { name: string; order: number; text: string }): () => void
  getSectionOrder?(name: 'TOOL_PTY'): number
}

const WORKBENCH_PROMPT = 'A collaborative workbench view shares interactive terminals with the human operator. Before acting on a terminal, always call workbench_terminal_list to inspect recentActivity and unreadBytes — the human operator may have run commands, modified files, or started build jobs. Human input is authoritatively recorded under recentActivity.'

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const profiles = new ProfileStore(resolved.dataDir)
  const journal = new JournalStore(resolved.dataDir)

  const manager = new WorkbenchTerminalManager({
    allowlist: resolved.allowlist,
    maxSessions: resolved.maxSessions,
    defaultPort: resolved.defaultPort,
    connectTimeoutMs: resolved.connectTimeoutMs,
    maxScrollbackBytes: resolved.maxScrollbackBytes,
    keepaliveIntervalMs: resolved.keepaliveIntervalMs,
    onOpen: session => journal.attach(session),
  })

  ctx.effect(() => () => {
    void manager.closeAll()
  }, 'workbench: manager teardown')

  for (const tool of createTools(manager, resolved, profiles)) {
    ctx.tools.register(tool)
  }

  const systemPrompt = (ctx as unknown as { systemPrompt?: SystemPromptFace }).systemPrompt
  if (systemPrompt !== undefined) {
    ctx.effect(() => {
      try {
        const order = systemPrompt.getSectionOrder?.('TOOL_PTY') ?? 1700
        return systemPrompt.section({
          name: 'tool:workbench',
          order: order + 2,
          text: WORKBENCH_PROMPT,
        })
      }
      catch {
        return () => {}
      }
    }, 'workbench: prompt section')
  }

  try {
    registerWorkbenchGateway(ctx, {
      terminalManager: manager,
      profileStore: profiles,
      journalStore: journal,
      trustedHosts: resolved.trustedHosts,
    })
  }
  catch (err) {
    console.warn(`[dsh-workbench] gateway registration skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
}
