# dsh-plugin-blackboard

DeepSeek Harness 插件：把 [blackboard](https://github.com/Fruit-Guardians/blackboard)（Agent 外置记忆）作为原生工具接入 DSH 会话。
本仓库就是插件包本身，包根即仓库根。

插件**不实现黑板语义**：每个工具都在**会话工作目录**里调用一份外部 blackboard 发行版中的 `blackboard` CLI，
因此事件日志、加锁、脱敏、多 Agent 游标、原子写的行为与终端、Claude Code 接入完全一致。
插件只做三件事：把 CLI 包装成 11 个带类型的原生工具、注册一段简短的系统提示段落、
在会话视图环里加一个「黑板」标签（画布 / 列表两种模式）。

## 快速开始

```bash
# 1. 准备一份 blackboard 发行版（二选一，见下文「解析顺序」）
npm i --no-save github:Fruit-Guardians/blackboard        # → 本包 node_modules/blackboard/
git clone https://github.com/Fruit-Guardians/blackboard ../blackboard   # 或放在本仓库旁边

# 2. 装进目标 profile
dsh plugin --profile web add /path/to/Blackboard_Plugin

# 3. 首次安装重启一次 dsh web，然后刷新页面
```

## 依赖：一份 blackboard 发行版

插件自身只依赖 DSH，不带任何黑板实现。它需要一份**发行版**（检出或已安装的副本）：

| 发行版内路径 | 插件用它做什么 |
| --- | --- |
| `bin/blackboard.js` | 每个工具调用 spawn 的 CLI |
| `lib/` | 宿主侧快照按需动态导入，复用 CLI 同一套重放代码 |
| `skills/blackboard/` | `npm run skill:install` 复制的整棵技能树 |
| `public/` | 画布模式内嵌的、构建好的查看器 |

不 vendor 任何 `lib/`：`lib/` 的分叉会成为事件日志的第二个事实源。

### 解析顺序

按顺序取第一个可用项：

| # | 来源 | 指向 | 说明 |
| --- | --- | --- | --- |
| 1 | 配置 `cliPath` | `.../bin/blackboard.js` | 显式指定，优先级最高 |
| 2 | 环境变量 `BLACKBOARD_CLI` | `.../bin/blackboard.js` | 指到 CLI 文件 |
| 3 | 环境变量 `BLACKBOARD_ROOT` | 发行版根目录 | 会校验 `<root>/bin/blackboard.js` 存在 |
| 4 | `node_modules/blackboard` | `<本包根>/node_modules/blackboard` | `npm i github:Fruit-Guardians/blackboard` 落在这里 |
| 5 | 旁边的检出 | `<本包根>/..` | 开发布局：插件位于 `blackboard/dsh-plugin` |
| 6 | `PATH` | `blackboard` | 支持 launcher 生成的 shim 与符号链接，反查真实 CLI 与根目录 |

1–3 是「明确配置但指错」：路径不存在会在插件加载时记一条警告，
之后每次工具调用返回明确错误，**插件本身照常加载**——坏路径不会让整个 profile 启动失败。
4–6 全部落空时同样如此：插件加载成功，每个工具调用返回解析错误。

第 6 项如果只能找到一个来源不明的可执行文件，它仍可作为命令使用，
但 `<root>/lib`（快照）与 `<root>/public`（画布）不可用。

### 本地准备一份发行版

```bash
# 装进本包 node_modules/ 的一份（--no-save 不改本仓库 package.json）
npm i --no-save github:Fruit-Guardians/blackboard

# 或与插件并排的检出（开发布局）
git clone https://github.com/Fruit-Guardians/blackboard ../blackboard

# 或使用已经在 PATH 上的安装
blackboard --version
```

## 安装

```bash
dsh plugin --profile web add /path/to/Blackboard_Plugin
```

`dsh plugin add` 会初始化 profile（若还没有）、写入 `link:` 依赖，
并因为本包声明了 `dsh.bundle.patch`（`cordis.patch.yml`）而自动把它追加进 `dsh.profile.bundles`，
不需要手工改清单。

要手工接入（例如发布后的 registry 版本），等价做法是在 profile 的
`~/.dsh/profiles/<name>/cordis.patch.yml` 里插入一行：

```yaml
- insert:
    - id: blackboard
      name: 'dsh-plugin-blackboard'
```

### 两个必须满足的条件

否则插件加载后工具调用会以模块解析失败告终：

1. 插件必须作为 profile 的依赖安装（`link:` 或 registry），而不是仅靠绝对路径的 patch 行；
2. 本包 `peerDependencies` 必须列出插件导入的每个 `@deepseek-ai/*` 包
   （当前为 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`），DSH 才能把裸导入路由到安装副本。

浏览器半边由宿主按 `dsh.client` 声明打包进模块图，**改完客户端代码要刷新页面**（`Cmd/Ctrl+R`）；
如果整个插件是首次安装，先重启一次 `dsh web`。

### 卸载

```bash
dsh plugin --profile web remove dsh-plugin-blackboard
```

> 插件中心（市场）列的是 marketplace 索引里的插件，本地 link 安装不会出现在那里；
> 已安装的 bundle 会出现在「设置 → 插件」的已安装列表里，本包带 `icon.svg` 与
> `locale/*.json` 的 `meta.title/description`，所以会显示名称与说明。

## 工具

11 个原生工具，全部是 CLI 命令的薄包装：参数整形、工作目录解析、面向模型的结果渲染。

| 工具 | 作用 | 对应 CLI | 写 |
| --- | --- | --- | --- |
| `blackboard_brief` | 恢复摘要：计数、当前游标、邻域、轨迹、开放节点、检查点 | `digest --json` | 否 |
| `blackboard_context` | 有界的任务上下文包（focus / depth / budget / since） | `context --markdown` | 否 |
| `blackboard_show` | 查看单节点（含双向关系），或列出最近节点 | `show <id> --json` / `ls --json` | 否 |
| `blackboard_add` | 新建节点（类型、详情、状态、严重度、置信度、标签、位置） | `node add <类型> "标题"` | 是 |
| `blackboard_edit` | 修改节点字段 / 生命周期状态（done、blocked、open…） | `edit <id> …` | 是 |
| `blackboard_link` | 建立显式关系（`from --relation--> to`） | `link <from> <to> --rel` | 是 |
| `blackboard_unlink` | 撤销一条关系（日志保留历史） | `unlink <from> <to> [--rel]` | 是 |
| `blackboard_remove` | 移除节点及其关系（日志保留历史；退役论断优先用 `edit`） | `remove <id> [--reason]` | 是 |
| `blackboard_focus` | 移动 Agent 游标（节点 / `next` / `clear`），不建边 | `focus <to> [--reason]` | 是 |
| `blackboard_checkpoint` | 保存恢复检查点 | `checkpoint [--summary]` | 是 |
| `blackboard_init` | 显式初始化 `.blackboard/`（仅在用户要求时） | `init [--title]` | 是 |

另注册一个简短的系统提示段落（`order: 9000`），说明黑板可用时机与「游标不是父节点」等约束。
插件不注入任何自动摘要，也不改变模型收到的其他上下文。

<details>
<summary><strong>工具参数</strong></summary>

| 工具 | 参数 |
| --- | --- |
| `blackboard_context` | `focus`（节点 id 或唯一前缀，默认游标）、`depth`（0–5，默认 2）、`budget`（近似 token，默认 4000）、`since`（检查点 id 或时间戳） |
| `blackboard_show` | `id`（省略则列表）、`type`（列表按类型过滤）、`open`（只看 open 的 intent / hypothesis / question）、`limit`（默认 30） |
| `blackboard_add` | `type`\*、`title`\*、`detail`、`status`、`severity`、`confidence`、`tags`、`at`（`file:line`）、`parent`、`relation`、`reason`、`enter`、`relate_here` |
| `blackboard_edit` | `id`\*、`title`、`detail`、`status`、`severity`、`confidence`、`tags` |
| `blackboard_link` / `blackboard_unlink` | `from`\*、`to`\*、`relation`（默认 `related-to`）、`label` |
| `blackboard_remove` | `id`\*、`reason` |
| `blackboard_focus` | `to`\*（节点、`next` 或 `clear`）、`reason` |
| `blackboard_checkpoint` / `blackboard_init` | `summary` / `title` |

\* 为必填。`blackboard_add` 创建节点**不**自动连边、**不**自动移动游标；`enter: true` 或 `relate_here: true` 才生效。

</details>

## 界面：「黑板」标签

插件在会话视图环里注册一个「黑板」标签（`order: 20`，紧挨着「轨迹」），
标签内两种模式，右上角一键切换。

| 模式 | 数据来源 | 端口 |
| --- | --- | --- |
| 列表（轻量只读） | 宿主路由 `GET <base>/api/blackboard/snapshot?session=<id>`（用 CLI 同一套库重放事件日志） | 无 |
| 画布（默认） | 宿主路由 `GET <base>/api/blackboard/viewer?session=<id>` 先确保一个 `blackboard serve` 子进程，再把它的 `http://127.0.0.1:<随机端口>` 嵌进 iframe | 仅画布打开时占用一个 loopback 随机端口 |

- **画布**：直接内嵌发行版 `public/` 里构建好的查看器，分组框、阶段筛选、搜索、检查器、缩放、代码定位、
  SSE 实时刷新都与 `blackboard serve` 一致，只是嵌在标签里。
- **列表**：搜索 + 节点详情 + 入边/出边 + 当前游标标记，零端口、秒开。
- **全屏**：把标签放大到全屏，`Esc` 退出；内嵌查看器也带 `allowfullscreen`。
- 两种模式都以**当前会话工作区**（找不到就向上找最近的 `.blackboard/`）为准。
- 浏览器端按 document-relative 请求路由，兼容子路径部署；同一块黑板只起一个查看器进程（按 board root 复用）。

> 画布能力要求宿主半边重新加载：**改了这部分代码要重启 `dsh web`**（路由在插件 apply 时注册），然后刷新页面。

### 端口与进程生命周期

| 时机 | 行为 |
| --- | --- |
| 插件卸载 / profile 重载 / `dsh web` 正常退出 | 立即：`stopAll()` 杀掉查看器所在的整个进程组 |
| 宿主被强杀（SIGKILL、崩溃） | `scripts/serve-guard.mjs` 每 2s 检查父进程，发现被 reparent（ppid 变 1）即杀掉查看器并退出 |
| 画布闲置 `viewerIdleMs`（默认 30 分钟） | 回收器停止它；画布模式每 60s 心跳一次续期，下次打开画布重新起一个新随机端口 |
| 查看器自身崩溃 | 立即释放；下次打开画布自动重启 |

**不会**立刻释放的情况：把标签切到「列表」、切到别的会话/项目、关掉浏览器标签页本身
（都会保留 30 分钟，方便随时切回来）；不同项目各一个进程，各自计时。

## 配置

插件行支持以下配置（在 bundle patch 之后用 profile 自己的 `cordis.patch.yml` 覆盖）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `cliPath` | 自动 | `blackboard` CLI 的绝对路径；缺省走上面的解析顺序。路径不存在时插件仍会加载，但每次工具调用会返回明确错误 |
| `agentId` | 不注入 | 显式配置时作为 `BLACKBOARD_AGENT` 注入每次 CLI 调用（游标 / 检查点的 Agent 身份）。**不配置就不注入**：继承到的 `BLACKBOARD_AGENT`、或 CLI 自己的 `agent:primary` 默认值继续生效 |
| `prompt` | `true` | 是否注册系统提示段落 |
| `timeoutMs` | `30000` | 单次 CLI 调用的超时 |
| `viewerIdleMs` | `1800000` | 画布查看器闲置多久后回收（毫秒）；`0` 表示不自动回收 |

```yaml
- id: blackboard
  config:
    cliPath: /Users/me/code/blackboard/bin/blackboard.js
    prompt: true
```

插件还会把以下环境变量用于发行版解析（1–3 见「解析顺序」）：

| 变量 | 用途 |
| --- | --- |
| `BLACKBOARD_CLI` | 指向 `bin/blackboard.js` |
| `BLACKBOARD_ROOT` | 指向发行版根目录 |
| 其他 `BLACKBOARD_*` | 基本原样透传给 CLI，例如 `BLACKBOARD_AGENT=research` 让并行 Agent 各用各的游标；插件会先删掉 `BLACKBOARD_CWD`/`FLOW_CWD`，并固定 `BLACKBOARD_QUIET=1`。配置了 `agentId` 时它以 `BLACKBOARD_AGENT` 覆盖继承值 |

## 可选 Skill

不需要 skill 也能用（原生工具 + 系统提示段已经足够）。想要一份「何时记录、记录什么、审计与并行 Agent 场景怎么写」
的固定规程时，可以安装发行版里打包好的技能：

```bash
npm run skill:install          # → <项目根>/.dsh/skills/blackboard/
npm run skill:install:user     # → ~/.dsh/skills/blackboard/（对所有项目生效）
```

安装内容是**已解析到的发行版**里 `<root>/skills/blackboard/` 整树
（`SKILL.md` + `references/{setup,recording,audit,parallel-agents}.md`）。安装器会：

- 把 `__BLACKBOARD_CLI__` 展开成实际 CLI 路径；
- 在 `SKILL.md` 里插入一段「DSH 下优先用原生工具」的前言，避免模型只会走命令行；
- 清理非 APFS 卷生成的 `._*` 伴随文件；重复执行幂等（只保留一段前言）。

两种失败都是硬错误（exit 1）：完全解析不到发行版时报「没找到 blackboard 分发，无法定位 skills/blackboard/。」并附上候选清单；
发行版存在但缺少 `skills/blackboard/` 时报「packaged skill not found」。先修好发行版路径再装。
DSH 会在**新会话**的技能目录里自动发现它，不需要重启；DSH 同时扫描 `.agents/skills`（Codex 的安装位置），
同名时 `.dsh/skills` 的优先级更高。

## 行为与边界

- **工作目录**：优先用 DSH 的实时会话目录 `ctx.workingDirectory.get(session)`（会话中途 `cd` 也会跟随），
  退化顺序为 `session.header.cwd`（创建目录）→ `session.meta.cwd` → 进程目录。CLI 以该目录为工作目录启动，
  并且**不注入 `BLACKBOARD_CWD`/`FLOW_CWD`**（已有的也会先删掉）——一旦显式指定项目目录，CLI 就会跳过向上查找，
  子目录会话会错误地新建一块嵌套黑板。让 CLI 自己像 git 一样向上找最近的 `.blackboard/`，
  子目录（以及 `cd` 之后的会话）才会正确命中项目根的黑板。
- **无黑板时**：读工具（`brief` / `context` / `show`）返回 CLI 的提示「当前目录没有 `.blackboard/`。先运行 `blackboard init`」。
  写工具沿用 CLI 的宽进语义：第一条记录会在工作目录自动创建 `.blackboard/`（同时写入 `.blackboard/.gitignore`，默认不进版本库）。
  `blackboard_init` 用于用户明确要求启用黑板时显式初始化并命名；若上级目录已有黑板，CLI 会拒绝重复初始化，此时应改用上层黑板。
- **同步执行**：每个工具调用 spawn 一次 CLI（约 50–150ms），不在后台常驻进程。
- **敏感内容**：黑板是明文 `.blackboard/events.jsonl`，默认通过 `.blackboard/.gitignore` 排除出版本库，但不要写入密钥。
- **不干扰其他接入**：Claude Code 的 Skill/Hook、`blackboard serve` 可视化服务、`blackboard` CLI 均可同时使用同一块黑板。
  并行 Agent 请各自使用不同的 `BLACKBOARD_AGENT`（或在插件配置里设 `agentId`），避免互相覆盖游标。

## 维护：不要在仓库里留下 `._*` 文件

在 exFAT / 部分 U 盘 / SMB 这类非 APFS 卷上，macOS 会给每个文件生成一个 `._<文件名>` 的
AppleDouble 伴随文件。DSH 读取插件元信息时会扫描 `locale/`，并要求其中每个 `*.json`
的文件名都是语言 id —— 一旦出现 `locale/._en.json`，整个插件就会报
「包元信息错误：… must use a language id as its filename」。

因此：

- 仓库自带 `.gitignore` 忽略 `._*`、`node_modules/`、`.DS_Store` 与 `*.log`，别把它们提交进去；
- 在盘上写完文件后跑一次 `npm run clean:meta`（`scripts/strip-appledouble.mjs`）；
- 用 rsync 同步时带上 `--exclude '._*'`；
- 报错时直接删掉 `locale/` 下的 `._*.json`，然后刷新页面（必要时重启 `dsh web`，元信息可能被进程缓存）。

## 测试

```bash
npm test                                   # node --test test/ —— 48 个用例
node --test test/                          # 等价写法
```

用例在临时目录里驱动真实 CLI 板：初始化、加节点、建边、移动游标、编辑、查询与错误映射，
以及宿主路由、查看器进程生命周期和浏览器半边（`node:vm` 里加载 bundle 并校验标签注册）。
`test/root.test.js` 专门覆盖发行版解析与自包含性：配置 / 环境变量 / `node_modules/blackboard` / 旁边的检出 / PATH shim 的优先级，
缺失发行版时的降级（词汇表回退、快照按请求失败而不拖垮进程），以及「插件不向目录外取模块」的回归守卫。

测试需要能解析到一份 blackboard 发行版（开发布局下就是旁边的检出）。独立克隆的仓库要显式给一个：

```bash
BLACKBOARD_CLI=/path/to/blackboard/bin/blackboard.js npm test
# 或
BLACKBOARD_ROOT=/path/to/blackboard npm test
```

运行测试需要 Node ≥ 18（发行版自身的 `engines` 要求），插件自身的 `engines` 声明是 `dsh >= 0.2.1-rc.1`。

## 目录结构

```text
index.js                  插件入口：注册 11 个工具、系统提示段、宿主路由
lib/blackboard-root.js    发行版解析（上面的解析顺序）
lib/cli.js                spawn CLI、错误清洗、JSON 解析
lib/cwd.js                会话工作目录解析
lib/tools.js              11 个工具定义与参数
lib/snapshot.js           宿主侧只读快照投影（重放事件日志）
lib/route.js              两条宿主路由（snapshot / viewer）
lib/viewer.js             查看器子进程管理（复用、回收、stopAll）
lib/prompt.js             系统提示段落
lib/client.js             浏览器半边：「黑板」标签（画布 / 列表）
scripts/                  skill 安装、AppleDouble 清理、查看器父进程守护
test/                     node:test 用例
locale/*.json             插件元信息（中英文名称与说明）
icon.svg · cordis.patch.yml · package.json
```

## 许可

MIT © Fruit-Guardians。

上游项目（blackboard CLI、事件模型、查看器与 Agent Skill）见
[github.com/Fruit-Guardians/blackboard](https://github.com/Fruit-Guardians/blackboard)。