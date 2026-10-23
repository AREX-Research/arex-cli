# Releasing

[README](./README.md) | [Contributing](./CONTRIBUTING.md)

## Build and distribution

- npm: `@arex-research/cli`, depending on the published `@arex-research/ts-sdk`. `npm pack` builds `dist/` through `prepack`.
- Standalone executables: `npm run build:binary` builds the current host; `npm run build:binaries` uses Bun to cross-compile macOS arm64/x64, Linux arm64/x64 (glibc), and Windows x64 into `artifacts/`.
- Agent Skill: `arex-skills-<version>.tar.gz` on each GitHub Release. The same Skill is embedded in npm and standalone builds; edit its source as described in [CONTRIBUTING.md](./CONTRIBUTING.md#agent-skill).
- Each release also includes `install.sh`, `LICENSE`, and `SHA256SUMS`. The installer verifies downloads against these checksums before running them.

## Hosted release

CI (`.github/workflows/ci.yml`) runs `npm run validate` on pushes to `main` and pull requests. Use the **Release CLI** workflow (`.github/workflows/release.yml`) for releases.

1. Update `version` in `package.json` and `package-lock.json`, update `CHANGELOG.md`, and merge to `main`. Use a version that has no existing tag, GitHub Release, or npm publication.
2. Dispatch a verification-only run from `main`, and review its checks:

   ```sh
   gh workflow run release.yml --ref main -f publish=false
   ```

3. Dispatch the publishing run from the intended `main` commit:

   ```sh
   gh workflow run release.yml --ref main -f publish=true
   ```

Each run builds once and smoke-tests those exact files natively: the npm tarball is installed under Node 22 and 24 on Linux, macOS, and Windows, and each executable runs on its target platform. The publishing run repeats this verification before publishing its own tested artifacts. Publishing jobs verify checksums, publish the tested tarball through npm trusted publishing, then create the GitHub Release. They do not rebuild the artifacts or run repository code.

Publishing across services is not atomic. If a publishing job fails, use **Re-run failed jobs** on the same run within the artifact retention period (7 days). This reuses the original bytes and leaves completed jobs alone. Never rebuild a published version.

### Publisher configuration

Configure the npm trusted publisher for repository `AREX-Research/arex-cli`, workflow `release.yml`, and environment `release`. Restrict the GitHub `release` environment to the `main` branch. npm provenance is generated for public repositories.

## Manual fallback

When the hosted workflow cannot be used, run:

```sh
scripts/release-local.sh --no-publish
```

Prerequisites: clean `main` matching `origin/main`, Node 22, Bun 1.3.14, uv/Python 3.12, Docker, and authenticated `gh`.

The script builds in a clean worktree, checks npm packages in official Node 22/24 Linux containers, and checks Linux executables in arm64/amd64 containers. On an arm64 Mac, it also checks macOS executables natively and under Rosetta, downloading official x64 Node 22. Windows, macOS package checks, and unsupported or emulator-limited platforms are recorded as **not verified locally**, not passes.

Artifacts, checksums, release notes, logs, and `report.json` are retained in `.release-local/<version>-<commit>/`. Inspect the report and its unverified platforms before publishing. Run `scripts/release-local.sh` to reuse and recheck the files without rebuilding. Publishing requires typing the version; npm uses your existing `npm login` and requests its own OTP, then `gh` publishes the checked assets at the recorded commit. `--no-publish` publishes nothing; failed runs remain available for inspection.
