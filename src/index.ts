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
import { registerWorkbenchGateway, type WorkbenchGateway } from './gateway.ts'
import { readGitStatus } from './git.ts'
import { renderGitStatus, renderList, renderOpen, renderRead, renderSend } from './render.ts'
import { createSessionDirectory } from './session-registry.ts'
import { JournalStore } from './terminal/journal.ts'
import { WorkbenchTerminalManager, defaultLocalCwd } from './terminal/manager.ts'
import { ProfileStore } from './terminal/profiles.ts'
import { TerminalStore } from './terminal/store.ts'
import type { GitStatusSummary } from './render.ts'
import type { SessionCwdResolver } from './session-registry.ts'
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

/** The conversation the running tool call belongs to, when the loop supplies one. */
function agentSessionId(exec?: { agent?: { id: unknown } }): string | undefined {
  return exec?.agent === undefined ? undefined : String(exec.agent.id)
}

export function createTools(
  manager: WorkbenchTerminalManager,
  config: ResolvedConfig,
  profiles?: ProfileStore,
  gateway?: WorkbenchGateway,
  sessionCwd?: SessionCwdResolver,
): ToolDefinition[] {
  const maxResultBytes = config.maxResultBytes

  return [
    defineTool({
      name: 'workbench_terminal_open',
      description: 'Open a collaborative interactive shell terminal (local or SSH) attached to the workbench. The human operator can watch and type in this terminal in real-time. Use kind="local" (default) to execute in the current session workspace, or kind="ssh" for remote servers.',
      parameters: {
        kind: { type: 'string', enum: ['local', 'ssh'], description: 'Terminal type: "local" (default) or "ssh".' },
        name: { type: 'string', description: 'Display name for the terminal tab.' },
        cwd: { type: 'string', description: 'Working directory for local shell. Omit to use this session\'s workspace directory.' },
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
        const sessionId = agentSessionId(exec)
        // Local shells land in the conversation's own workspace: the model's
        // tool call is attributed to its session, and the session header names
        // the directory. Without a session (a headless host), the manager's
        // project-root heuristic remains the fallback.
        const cwd = args.cwd ?? base?.cwd ?? (sessionCwd ? await sessionCwd(sessionId) : undefined)

        const { snapshot, banner } = await manager.open({
          kind,
          name: args.name ?? base?.name,
          sessionId,
          cwd,
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
        // The model's result waits for the shell's own banner — that is the
        // one caller for which the cwd and prompt in it are worth the wait.
        const motd = await banner
        const view = manager.get(snapshot.terminalId).collaborationView()
        gateway?.broadcastTerminalOpened(view)
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
      description: 'List the collaborative terminals belonging to the current conversation, with unread output count and recent human activity. Terminals opened by other sessions are not listed — each session has its own workspace and its own terminals.',
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
              busy: { type: 'boolean' },
              busyActor: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderList(value, maxResultBytes) }],
      },
      execute(_args, exec) {
        const list = manager.listDetailed(5, agentSessionId(exec))
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

    defineTool({
      name: 'workbench_browser_open',
      description: 'Open a page in the shared workbench browser — the human sees it rendered live in the right-hand panel (the panel auto-reveals). Local files and localhost URLs render fully interactive; external http(s) sites are served through a built-in reader proxy (scripts stripped, links keep working inside the panel), so pages like baidu.com display fine despite X-Frame-Options.',
      parameters: {
        url: { type: 'string', required: true, description: 'The URL or local file path to open. External sites go through the reader proxy automatically.' },
        title: { type: 'string', description: 'Tab display title.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            url: { type: 'string', required: true },
            title: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `opened workbench browser tab "${value.title}" [${value.url}] — visible to the human now`,
        }],
      },
      execute(args: { url: string; title?: string }) {
        if (!gateway) throw new Error('workbench gateway not available')
        const tab = gateway.openBrowserTab(args.url, args.title)
        return Promise.resolve(cleanLossless(tab))
      },
      presentCall: args => ({ card: 'generic', title: `Open in Workbench Browser: ${args.title || args.url}`, kind: 'execute' }),
    }),

    defineTool({
      name: 'workbench_browser_list',
      description: 'List open workbench browser tabs (id, url, title) so you can reference or close them.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              url: { type: 'string', required: true },
              title: { type: 'string', required: true },
              sessionId: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0 ? '(no workbench browser tabs open)' : value.map(t => `${t.id} "${t.title}" [${t.url}]`).join('\n'),
        }],
      },
      execute() {
        if (!gateway) throw new Error('workbench gateway not available')
        return Promise.resolve(cleanLossless(gateway.listBrowserTabs()))
      },
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: 'List Workbench Browser Tabs', kind: 'read' }),
    }),

    defineTool({
      name: 'workbench_browser_close',
      description: 'Close a workbench browser tab by id (from workbench_browser_open or workbench_browser_list).',
      parameters: {
        id: { type: 'string', required: true, description: 'Browser tab id.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            closed: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.closed ? `closed browser tab ${value.id}` : `browser tab ${value.id} was not open` }],
      },
      execute(args: { id: string }) {
        if (!gateway) throw new Error('workbench gateway not available')
        const existed = gateway.listBrowserTabs().some(t => t.id === args.id)
        gateway.closeBrowserTab(args.id)
        return Promise.resolve(cleanLossless({ id: args.id, closed: existed }))
      },
      presentCall: args => ({ card: 'generic', title: `Close Browser Tab ${args.id}`, kind: 'execute' }),
    }),

    defineTool({
      name: 'workbench_git_status',
      description: 'Read the Git worktree of this session\'s workspace: current branch, ahead/behind counts, total added/deleted lines, and every changed path with its index/worktree status letters. Read-only and safe to call any time — use it to see what the human has already changed before you start editing, and again afterwards to confirm your own edits landed.',
      parameters: {
        cwd: { type: 'string', description: 'Repository directory to inspect. Omit to use this session\'s workspace directory.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            repository: { type: 'boolean', required: true },
            branch: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
            ahead: { type: 'integer', required: true },
            behind: { type: 'integer', required: true },
            additions: { type: 'integer', required: true },
            deletions: { type: 'integer', required: true },
            files: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  x: { type: 'string', required: true },
                  y: { type: 'string', required: true },
                  path: { type: 'string', required: true },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderGitStatus(value as GitStatusSummary) }],
      },
      async execute(args: { cwd?: string }, exec) {
        const cwd = args.cwd ?? (sessionCwd ? await sessionCwd(agentSessionId(exec)) : undefined) ?? defaultLocalCwd()
        const { view, error } = await readGitStatus(cwd)
        return cleanLossless({
          repository: view !== null,
          branch: view?.branch ?? null,
          ahead: view?.ahead ?? 0,
          behind: view?.behind ?? 0,
          additions: view?.additions ?? 0,
          deletions: view?.deletions ?? 0,
          files: view?.files ?? [],
          error,
        })
      },
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: 'Read Git Status', kind: 'read' }),
    }),

    defineTool({
      name: 'workbench_show',
      description: 'Reveal the collaborative workbench panel in the web UI — opens the right-hand split if the human has it closed. No terminal or browser side effects; use it when you want the human to watch a terminal session or a preview you are about to create.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summoned: { type: 'boolean', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.summoned ? 'workbench panel revealed to the human' : 'workbench gateway unavailable' }],
      },
      execute() {
        if (!gateway) throw new Error('workbench gateway not available')
        gateway.broadcastSummon()
        return Promise.resolve(cleanLossless({ summoned: true }))
      },
      presentCall: () => ({ card: 'generic', title: 'Show Workbench', kind: 'execute' }),
    }),
  ]
}

interface SystemPromptFace {
  section(section: { name: string; order: number; text: string }): () => void
  getSectionOrder?(name: 'TOOL_PTY'): number
}

const WORKBENCH_PROMPT = `A collaborative workbench view shares interactive terminals with the human operator. Before acting on a terminal, always call workbench_terminal_list and check each row's busy flag and recentActivity: the human may have run commands, modified files, or started jobs between your turns.

Coordination protocol:
- busy=true means a model command is still in flight on that terminal. Do NOT send again — a second concurrent send throws. The gateway blocks human keystrokes while your command runs (their Ctrl+C still passes through as an interrupt), so you own the input stream until your send returns.
- Terminal output you receive (send output, workbench_terminal_read) is sanitized for you: ANSI escapes stripped, TUI redraws and carriage-return overwrites resolved to final text. Full-screen programs (claude, vim, watch) still make poor tool targets — prefer their non-interactive flags (e.g. claude -p) and short commands.
- The display stream marks your input with an [AI]$ line; human keystrokes are attributed in recentActivity with a "human:" prefix. Treat recentActivity as authoritative for who did what.

Shared browser: workbench_browser_open renders a page in the human's workbench panel (the panel auto-reveals). Local files and localhost URLs are fully interactive; external http(s) sites are served through a built-in reader proxy (scripts stripped, navigation stays inside the panel), so public sites like baidu.com display fine. Use it whenever the human should SEE a page — search results, docs, dashboards — and workbench_browser_list/close to manage tabs.

Shared Git view: the human's panel has a live Git tab (branch, ahead/behind, changed paths, diffs) over this session's workspace. workbench_git_status reads the same worktree for you — call it before you start editing to see what the human already has in flight, and again afterwards to confirm your own edits are there. It is read-only; commit and branch operations stay with the human.`

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const profiles = new ProfileStore(resolved.dataDir)
  const journal = new JournalStore(resolved.dataDir)
  const terminalStore = new TerminalStore(resolved.dataDir)
  const sessionCwd = createSessionDirectory(ctx)

  const manager = new WorkbenchTerminalManager({
    allowlist: resolved.allowlist,
    maxSessions: resolved.maxSessions,
    defaultPort: resolved.defaultPort,
    connectTimeoutMs: resolved.connectTimeoutMs,
    maxScrollbackBytes: resolved.maxScrollbackBytes,
    keepaliveIntervalMs: resolved.keepaliveIntervalMs,
    onOpen: session => journal.attach(session),
    terminalStore,
  })

  // Restore terminals that were active before service restart so sessions survive
  void manager.restorePersisted().then((count) => {
    if (count > 0) {
      gateway?.broadcastTerminals()
    }
  })

  ctx.effect(() => () => {
    void manager.closeAll()
  }, 'workbench: manager teardown')

  let gateway: WorkbenchGateway | undefined
  try {
    gateway = registerWorkbenchGateway(ctx, {
      terminalManager: manager,
      profileStore: profiles,
      journalStore: journal,
      trustedHosts: resolved.trustedHosts,
      resolveSessionCwd: sessionCwd.resolveCwd,
      sessionExists: sessionCwd.exists,
    })
  }
  catch (err) {
    console.warn(`[dsh-workbench] gateway registration skipped: ${err instanceof Error ? err.message : String(err)}`)
  }

  for (const tool of createTools(manager, resolved, profiles, gateway, sessionCwd.resolveCwd)) {
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
}
