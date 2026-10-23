# AREX CLI reference

## Configuration

Human setup: `arex setup`. Input is hidden; the key is verified with a read-only request that creates nothing before it is saved. Never collect keys in chat or read/print saved keys.

`AREX_API_KEY` overrides the saved key. `AREX_BASE_URL` selects an HTTPS endpoint (plain HTTP only on localhost/loopback); default `https://api.arex-research.com`. A saved key is used only for its verified endpoint. Another endpoint needs its own environment key or human setup. No implicit `.env` loading.

`arex doctor --json` is read-only. A report with `ok: false` exits 1 but stays on stdout. Setup itself is interactive and does not support `--json`.

## Commands

```text
arex search <query|-> [--limit <count>] [--published-after <timestamp>] [--published-before <timestamp>]
arex contents <url> [--tier auto|flex] [--fresh] [--fresh-timeout <duration>] [--max-chars <count>]
arex research <question|-> [--mode auto|fast|deep] [--detach] [--timeout <duration>]
arex run status <run-id>
arex run wait <run-id> [--timeout <duration>]
arex run cancel <run-id>
arex run delete <run-id>
```

Use `--json` before or after the command. `-` reads a Search query or Research question from stdin; `--` ends option parsing. Durations need units: `500ms`, `30s`, `2m`. Search `--limit` is 1–10 (default 10). Publication bounds are UTC ISO 8601 (`...Z`): after is inclusive, before is exclusive, and after must precede before at whole-second granularity. Contents `--tier` defaults to `auto`; `flex` allows a longer retrieval budget. `--fresh-timeout` implies `--fresh`; `--max-chars` limits Markdown length. Research `--mode` defaults to `auto`; `--detach` conflicts with `--timeout`.

## Results and lifecycle

- Search: `{results: [{title, url, snippet?, publishedAt?}]}`.
- Contents: `{url, title?, publishedAt?, imageUrl?, imageUrls?, content, truncated}`.
- Research: `{id, status, mode, requestedMode, createdAt, startedAt?, completedAt?, message?, result?, error?}`. Completed runs have `result: {answer, sources: [{title, url}]}`; failed runs have `error: {code, retryable}`. Branch on `status`, not `message`.
  Response `status`, `mode`, `requestedMode`, and failure `error.code` strings are preserved, including unfamiliar values. Request `--mode` choices remain `auto`, `fast`, and `deep`.
- Delete: `null` when deletion finished, otherwise the run while cancellation/deletion is pending.
- Doctor: `{ok, checks: [{name, status, message}], nextSteps}`.

Success emits one direct JSON value on stdout, not an envelope. Optional fields remain absent.

- `research` waits for completion; `--detach` returns the admitted run without waiting. Active runs trigger a polling notice on stderr.
- `--timeout` bounds creation waiting and polling, not server-side execution. A very short creation timeout may leave a run going without a returned ID; use `--detach` when an immediate ID is needed.
- `run status` exits 0 for every returned status, including unfamiliar values. Waiting commands recognize only `completed`, `failed`, and `cancelled` as terminal; unfamiliar statuses stay in progress. Failed or cancelled runs exit 7 while waiting.
- Polling timeouts exit 6; interrupts exit 130/143. When a run is known, errors carry `error.runId`; resume with `run wait` rather than creating another run. Waiting never cancels research.
- `run cancel` cancels; `run delete` cancels an active run before deletion. Use only on explicit user request.

## Errors

Operation failures leave stdout empty and emit `{"error":{...}}` on stderr. Required fields: `kind`, `code`, `message`. Optional fields: `status`, `requestId`, `param`, `retryable`, `retryAfterMs`, `phase`, `timeoutMs`, `runId`, `run`. Doctor findings remain on stdout; help/version remain text.

| Exit | Meaning |
| --- | --- |
| 0 | Successful command |
| 1 | Doctor blocking findings, unclassified API failure, or unexpected failure |
| 2 | Syntax/configuration/input error |
| 3 | Authentication or permission denial |
| 4 | Rate limit, outstanding-run limit, or exhausted allowance |
| 5 | Not found, unavailable source, or lifecycle conflict |
| 6 | Network, invalid response, service failure, or timeout |
| 7 | Research failed/cancelled while waiting |
| 130 / 143 | SIGINT / SIGTERM |

Do not automatically repeat Search, Contents, or Research creation after an uncertain failure; inspect diagnostics first.
