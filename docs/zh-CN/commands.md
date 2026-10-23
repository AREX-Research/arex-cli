# 命令与输出

[README](../../README.zh-CN.md) | [English](../en/commands.md)

## 命令

```text
arex setup
arex doctor
arex search <query|-> [--limit <count>] [--published-after <timestamp>] [--published-before <timestamp>]
arex contents <url> [--tier auto|flex] [--fresh] [--fresh-timeout <duration>] [--max-chars <count>]
arex research <question|-> [--mode auto|fast|deep] [--detach] [--timeout <duration>]
arex run status <run-id>
arex run wait <run-id> [--timeout <duration>]
arex run cancel <run-id>
arex run delete <run-id>
arex skill path [--scope user|project]
arex skill install [--scope user|project] [--force] [--dry-run]
```

`--json` 可放在命令前后。每一层都支持 `--help`；不带参数显示帮助，不要求配置 Key。`--` 结束选项解析。

Search/Research 的问题参数为 `-` 时，读取 UTF-8 stdin 到 EOF，并去掉末尾一个换行。其他参数不会隐式读取 stdin。时间必须带单位，例如 `500ms`、`30s`、`2m`；也支持能转换成整数毫秒的 `1.5m`。

所有参数和选项在发送请求前都会通过 SDK 本地校验；省略选项时保留 SDK/服务端默认值。除 `research --timeout` 覆盖外，单次请求超时由 SDK 决定。

- `search`：`--limit`（`1`–`10`，默认 `10`）；`--published-after`（包含边界）与 `--published-before`（不包含边界）接受 UTC ISO 8601 时间戳（`...Z`），且按整秒精度 `--published-after` 必须早于 `--published-before`。
- `contents`：`<url>` 必须是不含凭据的 `http(s)` 绝对 URL。`--tier` 默认 `auto`，`flex` 提供更长检索预算。`--fresh-timeout` 隐含 `--fresh` 并设置实时抓取截止时间。`--max-chars` 限制返回的 Markdown 字符数。
- `research`：`--mode`（`auto`、`fast` 或 `deep`）默认 `auto`。`--detach` 不能与 `--timeout` 同用。

## Research 生命周期

- **默认（等待完成）**：`arex research` 默认等待引用式答案。`fast` 模式通常直接返回已完成的结果；`deep` 模式或耗时较长的任务会在 `stderr` 输出 `Running research (id: <id>)...` 并每 2 秒轮询至完成。
- **后台创建（`--detach`）**：任务受理后立即返回 Run（`queued` 或 `running`），不等待完成。
- **查询与管理任务**：
  - `run status <run-id>` 对所有返回的状态（包括未知值、`failed` 和 `cancelled`）均成功返回（退出码 0）。
  - 未带 `--detach` 的 `research` 与 `run wait <run-id>` 仅将 `completed`、`failed` 和 `cancelled` 视为最终状态。未知状态仍按进行中处理；`failed` 或 `cancelled` 退出码为 7。
  - `run delete <run-id>` 会先取消仍在运行的任务再删除；若取消/删除仍在进行中则返回当前 Run，删除完成后输出 `null`。

CLI 绝不会自行取消 Research：

- `--timeout` 同时约束创建等待与后续轮询的总预算，而非服务端执行截止时间。拿到 Run ID 后的轮询超时会报告 Run ID 并以退出码 6 退出；若极短的 `--timeout` 在服务端返回 Run ID 前就中断了创建请求，任务仍可能在后台继续执行并计入用量额度——需要立即拿到 Run ID 时应使用 `--detach`。
- 等待期间按 Ctrl-C 或收到 SIGTERM 会停止等待并报告 Run ID。再次收到信号则立即退出。
- 创建 Run 期间的中断会让该请求完成，因此报告的错误仍会带上 Run ID。

使用 `arex run wait <run-id>` 继续等待，或用 `arex run cancel <run-id>` 显式停止任务。`arex run delete <run-id>` 也会先取消仍在运行的任务再删除。

## Setup 与配置

在 <https://arex-research.com/platform/console/keys> 创建 Key。

`setup` 需要交互式终端，不支持 `--json`。密钥输入隐藏，新 Key 或保留的 Key 都通过不会创建任何内容的只读请求验证后再原子保存。空输入保留同一端点下已保存的 Key，不采用环境变量中的覆盖值。验证失败或取消输入不会保存变更。无法读取或格式错误的配置文件会被替换；符号链接或属主不符的配置文件会被拒绝。

配置优先级：

1. 非空的 `AREX_API_KEY` 环境变量。
2. `$XDG_CONFIG_HOME/arex/config.json` 中的 `apiKey`；XDG_CONFIG_HOME 未设置或不是绝对路径时使用 `~/.config/arex/config.json`。

Key 在磁盘上为明文。Setup 在 POSIX 上将 AREX 目录/文件权限设为 0700/0600，在 Windows 上限制 ACL 为当前用户。拒绝符号链接配置文件和目录。不自动加载 `.env`。

`AREX_BASE_URL` 可选，用于指定 API 地址或路径前缀，默认 `https://api.arex-research.com`。必须使用 HTTPS，仅本地开发时允许对 `localhost`/回环地址使用明文 HTTP；不能包含凭据、查询参数或 fragment。已保存的 Key 绑定到验证它时所用的端点：Setup 会把非默认端点记录在配置文件中，已保存的 Key 绝不会发送到其他地方。要使用其他端点，请为其设置 `AREX_API_KEY`，或在设置了 `AREX_BASE_URL` 的情况下运行 `arex setup`。

`doctor` 只读检查配置、实际凭据来源、端点和权限，通过 Research 查询诊断网络和认证。`doctor --json` 输出 `{ok, checks: [{name, status, message}], nextSteps}`；`ok: false`、退出码 1 表示阻塞问题，单独的警告不导致失败。诊断报告始终写 stdout，包括存在失败项时。

## 输出与错误

默认输出纯文本，无颜色依赖；移除外部内容的终端控制字符和方向覆盖字符。JSON 保留领域数据，输出一个紧凑 JSON 值和换行，不包裹响应 envelope。可选字段缺失时保持缺失。如果管道读取端提前关闭（`| head`），CLI 会安静地停止。

```json
{"results":[{"title":"Example","url":"https://example.com"}]}
```

JSON 结果结构（`?` 表示可选字段）：

- Search：`{results: [{title, url, snippet?, publishedAt?}]}`。
- Contents：`{url, title?, publishedAt?, imageUrl?, imageUrls?, content, truncated}`。
- Research：`{id, status, mode, requestedMode, createdAt, startedAt?, completedAt?, message?, result?, error?}`。已完成任务包含 `result: {answer, sources: [{title, url}]}`；失败任务包含 `error: {code, retryable}`。根据 `status` 而非 `message` 判断状态。
  响应中的 `status`、`mode`、`requestedMode` 和失败 `error.code` 字符串按原值显示；未知值不代表失败。请求 `--mode` 仍仅接受 `auto`、`fast` 和 `deep`。
- Delete：删除完成后为 `null`，否则为当前 Research Run。
- Skill path：`{path, scope}`；Skill install：`{path, scope, installed, dryRun}`。

操作错误保持 stdout 为空，stderr 输出文本或一个 `{"error":{...}}` 对象。JSON 错误包含 `kind`、`code`、`message`，以及可用的 `status`、`requestId`、`param`、`retryable`、`retryAfterMs`、`phase`、`timeoutMs`、`runId` 或最终 `run`。不输出 Key、堆栈或传输内部对象。帮助/版本仍为文本，Setup 为交互式，Doctor 使用上述诊断报告约定。

存在 Research Run 时抛出的错误都带有其 `runId`，包括等待超时、中断，以及轮询期间的网络或 API 错误。JSON 调用者可读取 `error.runId`，文本输出会显示 ID 和继续或查看任务的命令。使用 `arex run wait <run-id>` 继续等待，不要重复创建新的 Research 请求。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | Doctor 阻塞问题、未分类 API 错误或意外失败 |
| 2 | 命令语法、配置或输入错误 |
| 3 | 认证或权限错误 |
| 4 | 限流、并发 Run 限制或可用额度耗尽 |
| 5 | 资源不存在、来源不可用或生命周期冲突 |
| 6 | 网络、无效响应、服务错误或超时 |
| 7 | 等待 Research 时任务失败或取消 |
| 130 / 143 | SIGINT / SIGTERM（输入提示中 Ctrl-C 也返回 130） |

结果不确定时，不要自动重复 Search、Contents 或 Research 创建；先检查诊断。
