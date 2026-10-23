# AREX CLI

中文 | [English](./README.md)

在终端中搜索、阅读网页并完成研究。默认提供适合人类阅读的输出，脚本和 Agent 使用 `--json`。

## 安装

### 从 npm 安装

需要 Node.js 22 或更新版本：

```bash
npm install -g @arex-research/cli
```

### 从 GitHub Releases 安装

从 [GitHub Releases](https://github.com/AREX-Research/arex-cli/releases/latest) 获取独立可执行文件，无需 Node.js。

macOS、Linux 和 WSL：

```bash
curl -fsSL https://github.com/AREX-Research/arex-cli/releases/latest/download/install.sh | sh
```

脚本默认安装到 `~/.local/bin`（可通过 `AREX_INSTALL_DIR` 指定目录，通过 `AREX_VERSION` 指定版本标签），并询问是否加入 `PATH`。Linux 独立可执行文件需要 `glibc`（musl/Alpine 环境请使用 npm 安装）。卸载时把 `sh` 换成 `sh -s -- uninstall`。

Windows（PowerShell）：

```powershell
$dir = "$env:LOCALAPPDATA\Programs\arex"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://github.com/AREX-Research/arex-cli/releases/latest/download/arex-windows-x64.exe -OutFile "$dir\arex.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

之后请打开新的终端，使 `arex` 出现在 `PATH` 中。

## 配置

在 <https://arex-research.com/platform/console/keys> 创建 API Key，然后运行：

```bash
arex setup
arex doctor
```

`AREX_API_KEY` 会覆盖已保存的 Key。

## 使用

```bash
arex search "recent advances in AI agents"
arex contents https://example.com/article
arex research "Compare current agent evaluation frameworks"
```

Research 默认等待答案，`--detach` 立即返回已创建的 Run：

```bash
arex research "What changed?" --detach
arex run status <run-id>
arex run wait <run-id>
arex run cancel <run-id>
arex run delete <run-id>
```

中断或等待超时都不会取消 Research；`run cancel` 会取消，`run delete` 会先取消仍在运行的任务再删除。

完整选项、环境变量、JSON 输出与退出码见[命令、配置与输出](./docs/zh-CN/commands.md)。

## Agent Skill

让你的编程 Agent 学会使用该 CLI：

```bash
arex skill install
```

默认安装到 `~/.agents/skills/arex`，`--scope project` 改为 `./.agents/skills/arex`。

详见 [Agent Skill 安装与行为](./docs/zh-CN/agent-skill.md)。

## 开发

开发环境、`npm run validate` 和内置 Skill 编辑方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)；打包发布见 [RELEASING.md](./RELEASING.md)；私密漏洞报告见 [SECURITY.md](./SECURITY.md)（均为英文）。

## 许可证

[Apache-2.0](./LICENSE)
