# dsh-workbench

**把 AI 与人类的协作，从「你一句我一句的聊天」升级为「共享同一工作区的并肩作战」。**

dsh-workbench 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话级协同工作台插件：在对话旁的右侧栏里挂一块人机共用的实时面板 —— **协作终端、可读外网的预览浏览器、Git 变更面板、输入归属审计**。人类与 AI 看的是同一个画面，操作的是同一把 Shell。

<p align="center">
  <img src="docs/screenshots/terminal-split.png" width="920" alt="dsh-workbench 分屏协作：左侧对话，右侧人机共享终端" />
</p>

> 真实运行画面：左侧 agent 正在汇报它对工作台本身的体验反馈，右侧是人机共用的 Git Bash 终端 —— AI 的命令回显、人类的键入、彩色 git 输出、底部「协同已同步」状态，全部实时同帧。（本图拍于外壳迁移之前，面板内容与今日一致，差异只在顶部标签栏：现在工作台是右侧栏里的一个标签页。）

---

## 快速上手

工作台是 Harness **右侧栏里的一个标签页**，不再自建分屏，所以打开方式有三种：

| 入口 | 操作 |
|---|---|
| 会话头部按钮 | 点「工作台」——把工作台标签切到前台；已在前台时收起右栏 |
| 键盘 | `Ctrl + \`（macOS `⌘J`）同上 |
| 右侧栏自身 | 点右侧栏标签条上的 `+` → 向导页里选「协同工作台」 |

打开后，面板内还有它自己的一行标签条（终端 / 网页 / Git / 动态）和一个**分段式新建控件**：左半 `网页` 一键开浏览器，右半 `＋▾` 展开菜单（新建本地终端 / 打开 Git 面板 / 查看协同动态流）。所有"造东西"的动作只住在这一个控件里，终端尺寸、工作目录与网关连接状态只住在底部状态栏里。这些是"在工作台里新建一个面板"，和右侧栏那个 `+`（"给右侧栏新加一个标签页"）是两件事。

> **环境要求**：Harness ≥ `0.1.5-rc.1`。工作台注册为右侧栏标签页类型（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab`），这套契约在更早的版本里不存在。

---

## 核心能力

### 🖥️ 人机共享终端（真 PTY，不是模拟）

- **Windows 下运行在微软原生 ConPTY** 伪控制台上（node-pty），原生支持 ANSI 颜色、光标控制、`Ctrl+C` 信号与 readline 行编辑；自动探测真实 Git Bash（过滤 WSL/Store 假 bash），macOS/Linux 使用 `$SHELL`。
- **同一终端，两个操作者**：AI 通过工具下发命令，人类直接在 xterm.js 里敲键盘，双方输出实时双写。
- **输入归属审计**：每次键入都记录来源（`human` / `model`），`[AI]$` 标记线标识 AI 输入，`recentActivity` 提供最近操作时间线 —— 谁做了什么，可回溯。记录的是**可读文本**：方向键、焦点事件这类纯导航击键不产生条目，不会把一条命令淹在 `^[[I` 里。
- **多标签 + SSH**：本地 Shell 与远程 SSH 会话并列多开，连接配置可存为 Profile 复用。
- **不打扰你的 shell**：启动探测是纯被动的 —— 不向 shell 注入任何命令（旧实现写哨兵 `printf`，会让 shell 多打一个提示符、并把它写进 `~/.bash_history`）。

### 🗂️ 会话级工作区隔离

- **一个会话，一个工作区**：新终端的默认 cwd 取自会话自身记录的目录，而不是 dsh-web 的启动目录 —— 在 DeskAware 会话里开终端就落在 `D:\work\code\DeskAware`；会话没有记录时才回退到「向上寻找最近项目根」的启发式。
- **终端严格按会话归属**：`workbench_terminal_list` 与侧栏只显示当前会话的终端，两个会话之间不串台、不共享 Shell。孤儿终端（会话已被删除，或历史上没记归属）由第一个连接的会话「收养」，不会永久隐身。
- **失效 id 不再制造谜题**：引用已关闭、或属于上一个服务进程的 terminalId 时，错误信息直接列出当前可用 id，前端自动丢弃死标签并重新同步列表。
- **重启不丢终端**：终端规格持久化采用串行化的读改写，多个终端同一瞬间开启也不会互相覆盖（`~/.dsh-workbench/active_terminals.json`）。

### 🔒 AI 执行保护锁（并发不撞车）

AI 命令在途时（`busy`），网关在**服务端**拦截人类的普通击键 —— 键入不会混入命令流打乱 AI 的完成哨兵；`Ctrl+C` 始终放行，人类保有最高中断权。前端以琥珀色脉冲横幅提示「按键保护已生效」，标签页与状态栏同步显示 **AI 执行中**。

### 🧼 模型侧输出「熟化」（ANSI Sanitizer）

TUI 程序（Claude Code、进度条、watch）的原始输出是每秒上百帧的 `[K` 清行与光标跳转 —— 人眼在 xterm 里看到的是流畅动画，塞进模型上下文却是几千 token 的噪音。dsh-workbench 在 AI 面向通路上做**熟化**：

- 剥离全部 CSI / OSC / 字符集转义序列；
- 回车重绘解析为最终帧（spinner 三千行坍缩成一行结果）；
- 退格擦除（`10\b\b\b100%` → `100%`）、空行压缩。

人类 xterm 流保留完整 ANSI 不受影响 —— **两条通路各取所需**。开屏 banner、`workbench_terminal_send`、`workbench_terminal_read` 全部生效。

### 📣 模型召唤面板（Summon）

AI 打开终端 / 网页标签（或调用 `workbench_show`）时，工作台标签页会在所有已连接客户端自动切到前台并展开右栏 —— AI 的动作主动可见，人类不用翻找开关。人类随时可收起。

### 🌐 协同浏览器（外网页面可读，本地页面可交互）

- **新建标签页直接落地真实页面**：默认打开 `DEFAULT_HOME_URL`（`src/client/browser/BrowserView.tsx` 里一个常量，现为 `https://www.baidu.com`），而不是原地显示一个占位提示 —— 「新建网页标签」就该得到一个浏览器；
- **外网站点走内置阅读代理**：公网页面的 X-Frame-Options 只能挡住浏览器端 iframe，挡不住服务端抓取 —— 网关代抓页面、剥离脚本与 CSP、站内链接继续经代理流转，公开站点直接在面板里可看可点；
- **本地内容完整交互**：localhost 与本地文件**直连渲染、不经代理**（本地开发服务的热更新页面原样可用），本地文件经安全预览路由（`/dsh-workbench/preview`）渲染，杜绝 `file://` 死链白屏；
- 带地址栏（Omnibox）、前进 / 后退 / 刷新、复制与外开；输入纯数字端口自动补全 `http://localhost:<port>`；
- **模型可主动开页**：`workbench_browser_open` 打开的页面会自动召唤面板展示给人类 —— AI 查到的搜索结果、文档、仪表盘，人类同屏即见。

### 🌿 Git 变更面板（真读工作区，不是占位）

- 分支 / ahead-behind、增删行数、变更文件列表（`git status --porcelain` 语义）与逐文件 Diff，全部读会话自己的工作区，并支持刷新；
- 走 `execFile` 参数向量、绝不经 shell；`GIT_OPTIONAL_LOCKS=0` 不会刷新索引去和人类自己的 git 操作打架；未跟踪文件按全新增渲染（git 对它没有 diff）；
- 只读：提交与分支操作留给人。模型侧同一份实现暴露为 `workbench_git_status`，人与 AI 看到的是同一个工作区。

### 🗞️ 协同动态流（谁做了什么，一条时间线）

人类键入与 AI 下发按来源归属，逐条流式记录，可回看。服务端保留环形历史并在 attach 时回放，所以重开面板或重连不会看到空白；切换会话会清空，两个会话的操作不会串到一条线上。

### 🌗 亮暗双主题

<p align="center">
  <img src="docs/screenshots/light-theme.png" width="420" alt="亮色主题下的工作台面板" />
</p>

跟随 Harness 官方主题属性（`body[data-ds-dark-theme]`）自动切换：暗色是中性冷黑轴，亮色映射为 GitHub-Light 风格的雅致浅灰白 —— 主题切换瞬间，工作台与主界面始终浑然一体。

### ⌨️ 键盘流

| 快捷键 | 作用 |
|---|---|
| `Ctrl + \`（macOS `⌘J`） | 把工作台标签页切到前台；已在前台时收起右栏 |

右栏宽度、全屏与收回由 Harness 右侧栏自己的拖拽手柄和按钮提供。手柄用 pointer capture，所以拖动时面板里的网页预览不会把指针吞掉。

---

## 模型工具

| 工具 | 作用 |
|---|---|
| `workbench_terminal_open` | 打开本地（绑定会话 cwd）或 SSH 终端，返回 terminalId 与开屏 banner |
| `workbench_terminal_send` | 下发命令；`submit=true` 经哨兵协议等待完成并返回真实 exitCode |
| `workbench_terminal_read` | 分页读取熟化后的保留输出与最近人类/AI 活动记录 |
| `workbench_terminal_list` | 当前会话的终端快照：未读字节、`busy` 同步位、最近活动 |
| `workbench_terminal_close` | 关闭终端会话与底层进程 |
| `workbench_browser_open` | 在共享浏览器中打开页面（外网自动走阅读代理），面板自动召唤给人类 |
| `workbench_browser_list` / `workbench_browser_close` | 列出 / 关闭共享浏览器标签 |
| `workbench_git_status` | 读会话工作区的分支 / ahead-behind / 增删行数 / 变更文件（只读） |
| `workbench_show` | 无副作用召唤面板（直播前把人类请到屏幕前） |

系统提示词自动注入**协调协议**：先查 `busy` 再行动、busy 期间禁止并发 send、输出已熟化、`recentActivity` 是操作归属的权威来源。

---

## 安装

```sh
# 需要 Harness >= 0.1.5-rc.1

# 从 GitHub 安装（推荐 pin 到 commit）
dsh plugin --profile web add github:Lin-A1/dsh-workbench

# 或本地路径
dsh plugin --profile web add ./plugins/workspace/dsh-workbench
```

GitHub 安装会现场执行 `prepare` 构建 `lib/`，pnpm ≥10 若拦截构建脚本，在 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 放行：

```yaml
allowBuilds:
  node-pty: true
  ssh2: true
  esbuild: true
  cpu-features: true
```

## 配置（`cordis.patch.yml`）

```yaml
- insert:
    - id: dsh-workbench
      name: dsh-workbench
      config:
        allowlist: []              # SSH 允许列表，空 = 任意主机
        maxSessions: 16
        defaultPort: 22
        connectTimeoutMs: 15000    # 同时是启动捕获的上限（内部再封顶 2.5s）
        idleMs: 800
        sendTimeoutMs: 30000
        maxScrollbackBytes: 1048576
        maxResultBytes: 131072
        keepaliveIntervalMs: 15000
        dataDir: ~/.dsh-workbench  # 终端规格与 scrollback 日志
        trustedHosts: []           # LAN 部署时放行的可信 authority
```

---

## 工作原理

- **右侧栏标签页**：工作台是 Harness 右侧栏里的一个**标签页类型**（`ctx.sidebarRightTabs.register` + 键控 `sidebar.right.pane.tab` 的 body，key 为本插件的 `id`），列宽、标签条、全屏与拖拽手柄都归右侧栏自己。本插件不碰任何几何 —— 旧实现用 `body` 状态类加 `!important` 覆盖 AppFrame 的网格，是因为当年的 `details` 列既被钳制又被内联重写；那套 API 在 Harness 0.1.5 已被右侧栏标签页体系取代。
- **哨兵协议**：AI 命令尾部追加随机会话标签 `__DSHWB_DONE_<scope>_<seq>_<rand>__:$?`，从原始流中精准捕获完成时机与真实退出码；显示流过滤器对普通击键零延迟直出，仅暂存疑似哨兵前缀。
- **多路复用网关**：终端 / 浏览器 / Git 通道复用单条 WebSocket（`/dsh-workbench/ws`），帧协议见 `src/protocol.ts`；loopback + Host + Origin 三重校验，LAN 需显式配置 `trustedHosts`。
- **阅读代理**：外网页面由网关服务端抓取（12s 超时、8MB 上限、仅 text/html），剥离 `<script>` 与 CSP 元素，`<a>`/`<form>`/`<iframe>` 改写回代理路由形成闭环导航，`<base>` 锚定相对子资源 —— X-Frame-Options 从此不是面板的天花板。**不跟随 `https → http` 降级**：它既是安全倒退，也常常是死路（下节）。当页面只是一张"请改用明文 HTTP"的壳时，会改用该站移动版并渲染成原页面 + 顶部说明条。
- **会话存续**：终端规格与 scrollback 日志持久化到 `dataDir`，服务重启后自动恢复原会话，attach 即回放；attach 同时带上服务端保留的操作归属历史，重开面板不会看到空的动态流。
- **被动式启动**：启动只等 shell 自己把 banner 打完，且**只有出现可读文本后才开始计静默窗口** —— Windows 登录 shell 要 1 秒多跑 profile，按固定静默窗口会在它开口前就放弃。开标签页不再等 banner：shell 一活就出面板，只有模型的工具结果会等那行 banner。

## 对外表面

| 面 | 内容 |
|---|---|
| 注入的服务（服务端） | `tools`、`webServer`、`systemPrompt` |
| 注入的服务（浏览器端） | `slots`、`sidebarRight`、`sidebarRightTabs` |
| 读取的服务 | `sessionPersistence` —— 按会话查工作目录与存在性（用于绑定终端 cwd、判断孤儿终端归属） |
| 消费的 Harness 事件 | **无** —— 本插件不订阅 `session/*`、`agent/*`、`turn/*`；会话信息是查询而非事件流 |
| 注册的 HTTP 路由 | `/dsh-workbench/snapshot`、`/dsh-workbench/preview`、`/dsh-workbench/proxy` |
| 注册的 WS 路由 | `/dsh-workbench/ws` |
| 贡献的 UI | 右侧栏标签类型 `workbench`（含向导条目）、会话头部 `工作台` 按钮、`sidebar.right.pane.tab` 的 body |

## 已知边界

- **阅读代理只读**：它抓取并"烹饪"页面，所以登录态站点、需要交互重定向的流程用不了；这类页面请用工具栏的「在新窗口打开」在真浏览器里看。
- **动态流是内存环，不是日志**：服务重启后归属历史清空（终端输出有落盘 journal，操作归属没有）。
- **面板内是两层标签条**：外层是右侧栏的（工作台 / 向导 / 文件…），内层是工作台自己的（终端 / 网页 / Git / 动态）。外层标签条由右侧栏拥有，所以内层目前收不进它 —— 见路线图。
- **拖动分屏、全屏、收起不是本插件实现的**：它们归右侧栏，行为随 Harness 版本变化。

## 开发与验证

```sh
npx pnpm install
npx pnpm run build        # tsdown -> lib/index.js + lib/client.js
npx pnpm run typecheck    # tsc --noEmit
npx pnpm run lint         # oxlint src tests
npx pnpm test             # vitest run
```

## 路线图

- [x] **Phase 1** — 工作台基座 + 人机共享终端（ConPTY / SSH / 哨兵 / 召唤 / 保护锁 / 输出熟化）
- [x] 协同浏览器（Omnibox + 阅读代理 + 安全文件预览）
- [x] 亮暗双主题 + 全局快捷键
- [x] Git 变更面板（状态 + Diff + `workbench_git_status`）
- [x] 迁移为右侧栏标签页类型（Harness 0.1.5 契约）
- [ ] 内层标签条并入原生标签页（终端 / 网页 / Git / 动态 各成一个右侧栏标签类型，消除嵌套）
- [ ] **Phase 2** — 人机协同暂存与提交
- [ ] **Phase 3** — 受控浏览器协同（CDP 画面流 / DOM 树，人类可实时接管）
- [ ] **Phase 4** — 对话与工作台联动的高级协同体验

---

收录：[dsh-hub](https://github.com/Lin-A1/dsh-hub) · `plugins/workspace/dsh-workbench`。插件独立维护，许可证 MIT。
