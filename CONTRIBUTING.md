# Contributing

[README](./README.md) | [Releasing](./RELEASING.md) | [Security](./SECURITY.md)

## Development setup

Use Node.js 22 or later and [uv](https://docs.astral.sh/uv/) for Agent Skill validation. Bun is needed only for standalone executable builds; release tool versions are listed in [RELEASING.md](./RELEASING.md).

```sh
npm ci
npm run dev -- --help
```

For live API requests, create a key at <https://arex-research.com/platform/console/keys> and run `npm run dev -- setup` in your terminal, or set `AREX_API_KEY`. `.env.example` documents environment variables; the CLI does not automatically load `.env`. Never commit credentials or include them in an issue or pull request.

## Checks and changes

Before submitting a pull request, run:

```sh
npm run validate
```

This runs lint, type checking, tests, Skill validation, and the npm build. Individual checks are `npm run lint`, `npm run typecheck`, `npm test`, and `npm run skill:validate`.

Keep changes focused. For command behavior, use `src/program.ts` as the command/flag reference and `src/output.ts` and `src/error-output.ts` as the output/exit-code references. Update existing behavior tests when needed, and keep [English commands](./docs/en/commands.md), [Chinese commands](./docs/zh-CN/commands.md), and the bundled Skill consistent. Describe observable behavior rather than transport implementation. Record user-facing changes in [CHANGELOG.md](./CHANGELOG.md).

## Agent Skill

`skills/arex/SKILL.md` and `skills/arex/references/cli.md` are the editable Skill source. Keep the main Skill concise and place detailed commands and error guidance in its reference; installed Skills must work without this repository's other docs.

```sh
npm run generate:skill
npm run skill:validate
```

`scripts/generate-skill-module.ts` embeds those files into the ignored `src/generated-skill.ts`. Do not edit the generated module. The dev, typecheck, test, npm build, and executable build commands regenerate it automatically, so npm and standalone builds install the same source content.

User installation and behavior are documented in [Agent Skill](./docs/en/agent-skill.md) and its [Chinese translation](./docs/zh-CN/agent-skill.md).
