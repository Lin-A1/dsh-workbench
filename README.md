# dsh-workbench

人机协同交互工作台插件，服务于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
将 AI 与人类的协作从单一的聊天对话升级为**会话级协同工作台（Collaborative Workbench）**。

工作台直接依附当前会话（在会话的「对话」「轨迹」标签旁挂载**「工作台」**视图），人类与 AI 共享同一项目工作区（cwd），协同进行终端操作、代码版本控制与网页交互。

> 归类：收录于 `dsh-hub/plugins/workspace/dsh-workbench`（能力属于 `workspace/`，与上游 `packages/workspace` 对齐）。

---

## 四阶段演进路线

- **Phase 1（当前交付）**：**工作台基座 + 共同终端子系统**
  - 会话级视图标签 `conversation.view`（「工作台」），依附会话项目工作区。
  - 多路复用 WebSocket 通道 (`/dsh-workbench/ws`)。
  - 共同终端：支持本地 Shell（自动绑定项目 cwd）和远程 SSH 会话，xterm.js 多标签，人机输入实时归属记录（`human` vs `model`），AI 感知与 JSONL 历史回放。
  - 模型工具：`workbench_terminal_open`、`workbench_terminal_send`、`workbench_terminal_read`、`workbench_terminal_list`、`workbench_terminal_close`。
- **Phase 2（推进中）**：**Git 协同管理面板**
  - 工作区 Git 状态树、Diff 查看器、协同暂存/提交表单。
  - 模型工具：`workbench_git_status`、`workbench_git_diff`、`workbench_git_stage`、`workbench_git_commit`、`workbench_git_branch`。
- **Phase 3（规划中）**：**共同浏览器与 WebGUI 联动**
  - 工作台内嵌入受控浏览器画面/DOM 树，人类可实时观摩 AI 网页操作或手动接管。
- **Phase 4（规划中）**：**分屏与高级协同体验**
  - 工作台与对话分屏并排展示，全屏展开模式。

---

## 能力与模型工具

| 工具 | 作用 |
|---|---|
| `workbench_terminal_open` | 启动本地 Shell（默认 cwd 为会话目录）或 SSH 远程终端；返回 terminalId 与启动 banner |
| `workbench_terminal_send` | 向指定终端输入命令；`submit=true` 时追加哨兵并等待命令执行完，`submit=false` 静默返回 |
| `workbench_terminal_read` | 分页读取保留 scrollback，附带最近人类与 AI 的输入活动记录（`recentActivity`） |
| `workbench_terminal_list` | 列出当前活跃的协同终端快照、未读字节数（`unreadBytes`）及最近输入记录 |
| `workbench_terminal_close` | 关闭协同终端会话与底层进程 |

---

## 安装与配置

### 安装

```sh
# 本地插件安装（开发模式）
dsh plugin --profile web add ./plugins/workspace/dsh-workbench

# 或从 GitHub 安装
dsh plugin --profile web add github:Lin-A1/dsh-workbench
```

pnpm ≥10 如提示构建脚本拦截，请在 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 中放行：
```yaml
allowBuilds:
  cpu-features: true
  ssh2: true
  esbuild: true
```

### 配置 (`cordis.patch.yml`)

```yaml
- insert:
    - id: dsh-workbench
      name: dsh-workbench
      config:
        allowlist: []              # SSH 允许列表，空=允许任意主机
        maxSessions: 16
        defaultPort: 22
        connectTimeoutMs: 15000
        idleMs: 800
        sendTimeoutMs: 30000
        maxScrollbackBytes: 1048576
        maxResultBytes: 131072
        keepaliveIntervalMs: 15000
        trustedHosts: []           # LAN 部署时放行的可信 authority
```

---

## 开发与验证

```sh
npx pnpm install
npx pnpm run build        # tsdown -> lib/index.js + lib/client.js
npx pnpm run typecheck    # tsc --noEmit
npx pnpm run lint         # oxlint src tests
npx pnpm test             # vitest run
```
