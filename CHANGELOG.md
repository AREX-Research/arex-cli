# Changelog

## 1.0.1

Initial release of the AREX CLI: search, read, and research the web from your terminal.

- `arex search`, `arex contents`, and `arex research`, with human-readable output by default and `--json` for scripts and agents.
- `arex research` waits for the answer; `--detach` returns the run immediately, and `arex run status`, `wait`, `cancel`, and `delete` manage it afterwards.
- `arex setup` saves an API key and `arex doctor` checks it; `AREX_API_KEY` overrides the saved key.
- `arex skill install` installs the bundled Agent Skill so coding agents can use AREX.
- Install from npm (`@arex-research/cli`, Node.js 22 or later) or as a standalone executable for macOS, Linux, and Windows from GitHub Releases.
- Forward compatible: unfamiliar Research response values are preserved in output, and an unfamiliar status is treated as still in progress while waiting.
