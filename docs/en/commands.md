# Commands and output

[README](../../README.md) | [中文](../zh-CN/commands.md)

## Commands

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

`--json` can appear before or after the command. `--help` works at each level; no arguments shows help without requiring credentials. `--` ends option parsing.

Query operands equal to `-` read UTF-8 stdin to EOF, removing one trailing newline. Other operands never consume stdin. Durations require units: `500ms`, `30s`, `2m`; fractional units such as `1.5m` are accepted when they resolve to whole milliseconds.

All operands and options are validated locally with the SDK before sending a request; omitted options retain SDK/server defaults. Request timeouts are SDK-owned unless overridden by `research --timeout`.

- `search`: `--limit` (`1`–`10`, default `10`); `--published-after` (inclusive) and `--published-before` (exclusive) take UTC ISO 8601 timestamps (`...Z`), where `--published-after` precedes `--published-before` at whole-second granularity.
- `contents`: `<url>` must be an absolute `http(s)` URL without credentials. `--tier` defaults to `auto`; `flex` allows a longer retrieval budget. `--fresh-timeout` implies `--fresh` and sets the livecrawl deadline. `--max-chars` caps returned Markdown length.
- `research`: `--mode` (`auto`, `fast`, or `deep`) defaults to `auto`. `--detach` and `--timeout` cannot be combined.

## Research lifecycle

- **Default (waiting)**: `arex research` waits for a cited answer. `fast` runs usually return the completed answer directly; `deep` or longer-running runs emit `Running research (id: <id>)...` on stderr and poll every 2s until completion.
- **Detached (`--detach`)**: returns the admitted run immediately (`queued` or `running`) without waiting.
- **Inspecting and managing runs**:
  - `run status <run-id>` succeeds (exit 0) for every returned run status, including unfamiliar values, `failed`, and `cancelled`.
  - `research` (without `--detach`) and `run wait <run-id>` treat only `completed`, `failed`, and `cancelled` as terminal. Unfamiliar statuses remain in progress; `failed` or `cancelled` exits 7.
  - `run delete <run-id>` cancels an active run before deleting it; it may return the run while cancellation/deletion is still pending, or `null` once deleted.

The CLI never cancels research on its own:

- `--timeout` bounds the combined creation wait and any subsequent polling budget, not server-side execution. Once a run ID is returned, a polling timeout reports the run ID and exits 6; if a very short `--timeout` aborts the initial creation request before the server returns a run ID, the run may still execute in the background and count against your usage allowance—use `--detach` when an immediate run ID is required.
- Ctrl-C or SIGTERM while waiting stops waiting and reports the run ID. A second signal exits immediately.
- An interrupt while the run is being created lets that request finish, so the reported error still names the run.

Resume with `arex run wait <run-id>`, or stop the run explicitly with `arex run cancel <run-id>`. `arex run delete <run-id>` also cancels a run that is still going before deleting it.

## Setup and configuration

Create a key at <https://arex-research.com/platform/console/keys>.

`setup` requires an interactive terminal and does not support `--json`. Input is hidden. A new or retained key is verified with a read-only request that creates nothing before it is saved atomically. An empty response retains the saved key for the same endpoint, never an environment override. Verification failure or prompt cancellation does not save changes. An unreadable or malformed configuration file is replaced; a symlinked or foreign-owned one is refused.

Configuration precedence:

1. A nonempty `AREX_API_KEY` environment variable.
2. The `apiKey` field in `$XDG_CONFIG_HOME/arex/config.json`, or `~/.config/arex/config.json` when XDG_CONFIG_HOME is unset or relative.

Keys are plaintext on disk. Setup restricts the AREX directory/file to 0700/0600 on POSIX and to the current user's ACL on Windows. It refuses symlink config files/directories. `.env` is not automatically loaded.

`AREX_BASE_URL` optionally selects an API origin/path prefix; the default is `https://api.arex-research.com`. It must use HTTPS, except plain HTTP on `localhost`/loopback for local development, and must not include credentials, query or fragment. A saved key is bound to the endpoint it was verified against: setup records a non-default endpoint in the configuration file, and the saved key is never sent anywhere else. To use another endpoint, set `AREX_API_KEY` for it or run `arex setup` with `AREX_BASE_URL` set.

`doctor` is read-only. It inspects configuration, effective credential source, endpoint and permissions, then probes Research to check connectivity and authentication. `doctor --json` emits `{ok, checks: [{name, status, message}], nextSteps}`; `ok: false` and exit 1 indicate blocking findings, while warnings alone do not fail. Reports go to stdout even when findings fail.

## Output and errors

Default output is plain terminal text with no color dependency. Terminal escapes, control characters and bidirectional overrides from untrusted text are removed. JSON preserves domain data and emits one compact value plus a newline, without a response envelope. Optional fields remain absent. If the reading side of a pipe closes early (`| head`), the CLI stops quietly.

```json
{"results":[{"title":"Example","url":"https://example.com"}]}
```

JSON result shapes (`?` marks optional fields):

- Search: `{results: [{title, url, snippet?, publishedAt?}]}`.
- Contents: `{url, title?, publishedAt?, imageUrl?, imageUrls?, content, truncated}`.
- Research: `{id, status, mode, requestedMode, createdAt, startedAt?, completedAt?, message?, result?, error?}`. Completed runs have `result: {answer, sources: [{title, url}]}`; failed runs have `error: {code, retryable}`. Branch on `status`, not `message`.
  Response `status`, `mode`, `requestedMode`, and failure `error.code` strings are displayed unchanged; unfamiliar values do not imply failure. Request `--mode` choices remain `auto`, `fast`, and `deep`.
- Delete: `null` when deletion finishes, otherwise the current Research run.
- Skill path: `{path, scope}`; Skill install: `{path, scope, installed, dryRun}`.

Operation errors leave stdout empty and write text or one `{"error":{...}}` object to stderr. JSON errors include `kind`, `code`, `message`, and any available `status`, `requestId`, `param`, `retryable`, `retryAfterMs`, `phase`, `timeoutMs`, `runId`, or terminal `run`. Keys, stacks and transport internals are not emitted. Help/version remain text; setup is interactive; doctor findings use the report contract above.

Errors raised while a research run exists carry its `runId`, including waiting timeouts, interrupts, and network or API failures while polling. JSON callers read `error.runId`; text output prints the ID with the command to resume or inspect it. Resume with `arex run wait <run-id>` instead of starting another Research request.

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Doctor blocking findings, unclassified API failure, or unexpected failure |
| 2 | Syntax, configuration, or invalid input |
| 3 | Authentication or permissions |
| 4 | Rate limit, outstanding-run limit, or exhausted allowance |
| 5 | Missing resource, unavailable source, or lifecycle conflict |
| 6 | Network, invalid response, service failure, or timeout |
| 7 | Research failed or cancelled while waiting |
| 130 / 143 | SIGINT / SIGTERM (prompt Ctrl-C also uses 130) |

Do not automatically repeat Search, Contents, or Research creation after an uncertain failure; inspect diagnostics first.
