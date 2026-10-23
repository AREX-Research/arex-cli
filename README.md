# AREX CLI

[中文](./README.zh-CN.md) | English

Search, read, and research the web from your terminal. Human-readable output by default; `--json` for scripts and agents.

## Install

### From npm

Node.js 22 or later:

```bash
npm install -g @arex-research/cli
```

### From GitHub Releases

A standalone executable from [GitHub Releases](https://github.com/AREX-Research/arex-cli/releases/latest), no Node.js required.

On macOS, Linux and WSL:

```bash
curl -fsSL https://github.com/AREX-Research/arex-cli/releases/latest/download/install.sh | sh
```

The script installs to `~/.local/bin` (`AREX_INSTALL_DIR` overrides the directory; `AREX_VERSION` pins a release tag) and offers to add it to your `PATH`. Linux binaries require `glibc` (use npm on musl/Alpine). Uninstall with `sh -s -- uninstall` in place of `sh`.

On Windows (PowerShell):

```powershell
$dir = "$env:LOCALAPPDATA\Programs\arex"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://github.com/AREX-Research/arex-cli/releases/latest/download/arex-windows-x64.exe -OutFile "$dir\arex.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Open a new terminal afterwards so `arex` is on your `PATH`.

## Set up

Create an API key at <https://arex-research.com/platform/console/keys>, then:

```bash
arex setup
arex doctor
```

`AREX_API_KEY` overrides the saved key.

## Use

```bash
arex search "recent advances in AI agents"
arex contents https://example.com/article
arex research "Compare current agent evaluation frameworks"
```

Research waits for the answer. `--detach` returns the run immediately:

```bash
arex research "What changed?" --detach
arex run status <run-id>
arex run wait <run-id>
arex run cancel <run-id>
arex run delete <run-id>
```

Interrupting or timing out a wait never cancels research; `run cancel` does, and `run delete` cancels a run that is still going before deleting it.

See [Commands, configuration, and output](./docs/en/commands.md) for all options, environment variables, JSON output, and exit codes.

## Agent Skill

Teach your coding agent to use the CLI:

```bash
arex skill install
```

It lands in `~/.agents/skills/arex`; `--scope project` uses `./.agents/skills/arex` instead.

See [Agent Skill installation and behavior](./docs/en/agent-skill.md).

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, `npm run validate`, and editing the bundled Skill; [RELEASING.md](./RELEASING.md) for packaging and publishing; and [SECURITY.md](./SECURITY.md) for private vulnerability reporting.

## License

[Apache-2.0](./LICENSE)
