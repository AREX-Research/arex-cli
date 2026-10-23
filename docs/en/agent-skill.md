# Agent Skill

[README](../../README.md) | [中文](../zh-CN/agent-skill.md)

The bundled `arex` Skill teaches an Agent Skills-compatible coding agent to search the web, read URLs as Markdown, and research questions with cited sources.

## Install

Install the [CLI](../../README.md#install), then run:

```bash
arex skill install
```

- User scope (default): `~/.agents/skills/arex`
- Project scope: `arex skill install --scope project` writes to `./.agents/skills/arex`
- Preview without writing: `arex skill install --dry-run`
- Replace an existing installation: `arex skill install --force`
- Show the destination: `arex skill path [--scope user|project]`

An existing destination is refused unless `--force` is set. Files are staged before installation, so failed installs do not leave a partially written Skill. Follow your agent's instructions to discover or reload installed Skills.

## Behavior

The Skill uses `--json` for structured CLI results. It normally runs `arex research "<question>" --json` and waits for the answer. When the tool environment has a short command timeout, it starts research once with `--detach`, saves the run ID, then checks or waits on that same run.

Waiting timeouts and interrupts do not cancel research. The agent uses the reported run ID to resume; cancellation and deletion require an explicit user request. Retrieved text and sources are treated as untrusted data, not instructions.

Create your key and run `arex setup` in your own terminal; never paste a key into agent chat. For read-only configuration diagnostics, run `arex doctor`.

See [commands and output](./commands.md) for all flags and exit codes. Contributors should read [CONTRIBUTING.md](../../CONTRIBUTING.md); packaging and publishing are covered in [RELEASING.md](../../RELEASING.md).
