#!/usr/bin/env bash
# Manual counterpart of .github/workflows/release.yml; keep their steps in sync.
set -euo pipefail
export LC_ALL=C

printf '\n%s\n\n' 'WARNING: GitHub Actions Release CLI is the preferred release procedure. This script is a manual fallback when the hosted workflow cannot be used.'
publish=true
case "${1:-}" in
  --no-publish) publish=false ;;
  '') ;;
  *) echo 'Usage: scripts/release-local.sh [--no-publish]' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || exit 2
root=$(git rev-parse --show-toplevel)
cd "$root"
for tool in node npm bun uv uvx gh docker git; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
[[ $(node -p 'process.versions.node.split(".")[0]') = 22 ]] || { echo 'Use Node 22, as in release.yml (for example: mise exec node@22 -- scripts/release-local.sh --no-publish).' >&2; exit 1; }
[[ $(bun --version) = 1.3.14 ]] || { echo 'Install Bun 1.3.14, as pinned in release.yml.' >&2; exit 1; }
export UV_PYTHON=3.12
uv python find 3.12 >/dev/null
[[ $(git branch --show-current) = main ]] || { echo 'Release requires main.' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Release requires a clean worktree.' >&2; exit 1; }
git fetch origin main --tags
sha=$(git rev-parse HEAD)
[[ $sha = "$(git rev-parse origin/main)" ]] || { echo 'main must match origin/main.' >&2; exit 1; }
version=$(node -p "require('./package.json').version")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || { echo 'Invalid package version.' >&2; exit 1; }
repository=AREX-Research/arex-cli
run="$root/.release-local/$version-$sha"
worktree="$run/worktree"
files="$run/files"
report="$run/report.json"
reuse=false
if [[ -e $run ]]; then
  node -e 'const r=require(process.argv[1]); if(r.commit!==process.argv[2] || r.verificationStatus!=="passed") process.exit(1)' "$report" "$sha" || { echo "Incomplete run preserved at $run; inspect it before removing it and retrying." >&2; exit 1; }
  reuse=true
else
  mkdir -p "$files" "$run/logs"
  node - "$report" "$sha" "$version" "$publish" <<'JS'
const fs = require('node:fs');
const [path, commit, version, publish] = process.argv.slice(2);
fs.writeFileSync(path, JSON.stringify({commit, version, status:'running', publish:publish==='true', rerun:'scripts/release-local.sh --no-publish', artifacts:{}, checks:[]}, null, 2)+'\n');
JS
fi

record() {
  node - "$report" "$@" <<'JS'
const fs = require('node:fs');
const [path, name, command, result, detail, log] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(path));
report.checks.push({name, command, result, ...(detail ? {detail} : {}), ...(log ? {log} : {})});
fs.writeFileSync(path, JSON.stringify(report, null, 2)+'\n');
JS
}
finish() {
  local status=$?
  trap - EXIT
  if [[ -d $worktree ]]; then git -C "$root" worktree remove --force "$worktree" || status=1; fi
  node - "$report" "$status" <<'JS'
const fs = require('node:fs');
const [path, status] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(path));
report.status = status === '0' ? 'passed' : 'failed';
if(fs.existsSync(path.replace(/report.json$/, 'SHA256SUMS'))) {
  report.artifacts = Object.fromEntries(fs.readFileSync(path.replace(/report.json$/, 'SHA256SUMS'), 'utf8').trim().split('\n').map(line => {const [hash, file] = line.split(/\s+\*?/); return [file, hash];}));
}
report.notVerifiedLocally = report.checks.filter(check => check.result === 'not verified locally');
fs.writeFileSync(path, JSON.stringify(report, null, 2)+'\n');
JS
  echo "Report: $report"
  exit "$status"
}
trap finish EXIT
check() {
  local name=$1 command status
  shift
  printf -v command '%q ' "$@"
  if "$@" >"$run/logs/$name.log" 2>&1; then status=0; else status=$?; fi
  if [[ $1 = container_check ]]; then command=$container_command; fi
  cat "$run/logs/$name.log"
  if [[ $status = 0 ]]; then
    record "$name" "$command" passed '' "logs/$name.log"
  else
    record "$name" "$command" failed "Exit $status" "logs/$name.log"
    return "$status"
  fi
}
clashes() {
  if gh release view "$version" --repo "$repository" >"$run/logs/release-clash.log" 2>&1; then
    echo "Release $version already exists. Bump the version." >&2; return 1
  elif ! grep -qx 'release not found' "$run/logs/release-clash.log"; then
    cat "$run/logs/release-clash.log" >&2; return 1
  fi
  record release-clash "gh release view $version --repo $repository" passed 'Release does not exist' 'logs/release-clash.log'
  if git show-ref --verify --quiet "refs/tags/$version"; then
    echo "Tag $version already exists. Bump the version or remove the stale tag." >&2; return 1
  fi
  record tag-clash "git show-ref --verify --quiet refs/tags/$version" passed 'Tag does not exist' ''
  if npm view "@arex-research/cli@$version" version --registry https://registry.npmjs.org/ >"$run/logs/npm-clash.log" 2>&1; then
    echo "@arex-research/cli@$version already exists on npm. Bump the version." >&2; return 1
  elif ! grep -q 'code E404' "$run/logs/npm-clash.log"; then
    cat "$run/logs/npm-clash.log" >&2; return 1
  fi
  record npm-clash "npm view @arex-research/cli@$version version --registry https://registry.npmjs.org/" passed 'Version does not exist' 'logs/npm-clash.log'
}
check version-clashes clashes
record clean-main 'git status --porcelain; git branch --show-current; git fetch origin main --tags; git rev-parse HEAD origin/main' passed 'Clean main matches origin/main' ''
check docker docker info --format '{{.ServerVersion}} {{.OSType}}/{{.Architecture}}'
check worktree git worktree add --detach "$worktree" "$sha"
cd "$worktree"

sums() {
  if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
verify_files() { (cd "$files" && sums --check ../SHA256SUMS); }
if [[ $reuse = false ]]; then
  check npm-ci npm ci
  check validate npm run validate
  check npm-pack npm pack --pack-destination "$files"
  check binaries npm run build:binaries
  check copy-assets cp artifacts/arex-* install.sh LICENSE "$files"
  check skill-archive tar -czf "$files/arex-skills-$version.tar.gz" -C skills arex
  (cd "$files" && sums -- * | tee ../SHA256SUMS)
  record sha256sums '(cd files && sha256sum -- * | tee ../SHA256SUMS)' passed '' ''
  previous=$(git tag --sort=-creatordate | head -n 1)
  sdk=$(npm ls @arex-research/ts-sdk --json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).dependencies['@arex-research/ts-sdk'].version")
  {
    echo "**Give your agents the power to search, read, and research the web, powered by AREX’s public API.**"
    echo
    echo '## Install'
    echo
    echo '```sh'
    echo "npm install -g @arex-research/cli@$version"
    echo '```'
    echo
    echo 'Or, without Node.js, on macOS, Linux and WSL:'
    echo
    echo '```sh'
    echo "curl -fsSL https://github.com/$repository/releases/download/$version/install.sh | AREX_VERSION=$version sh"
    echo '```'
    echo
    echo "Files are listed in SHA256SUMS. Built with @arex-research/ts-sdk $sdk."
    echo
    echo "## What's changed"
    echo
    git log --no-merges --pretty='- %s' ${previous:+"$previous..HEAD"}
    if [[ -n $previous ]]; then
      echo
      echo "**Full changelog**: https://github.com/$repository/compare/$previous...$version"
    fi
  } > "$run/notes.md"
  record notes 'npm ls @arex-research/ts-sdk --json; git log --no-merges --pretty="- %s"; write release.yml notes' passed '' ''
fi
check artifact-integrity verify_files

# Mount the original files read-only. The checker chmods binaries, so copy only
# the executable into container scratch space after verifying the mounted files.
container_check() {
  local platform=$1 node=$2 mode=$3 asset=$4
  # shellcheck disable=SC2016 # Arguments expand inside the container, not on the host.
  local -a invocation=(docker run --rm --platform "$platform" \
    -v "$run:/release:ro" -v "$worktree/scripts/check-release.mjs:/checker.mjs:ro" \
    "node:$node" sh -ec '
      cd /release/files
      sha256sum --check ../SHA256SUMS
      if [ "$1" = binary ]; then
        cp "$2" "/tmp/$2"
        chmod +x "/tmp/$2"
        "/tmp/$2" --version
        node /checker.mjs --binary "/tmp/$2" --expected-version "$3" --sums /release/SHA256SUMS
      else
        node /checker.mjs --package "/release/files/$2" --expected-version "$3" --sums /release/SHA256SUMS
      fi
    ' sh "$mode" "$asset" "$version")
  printf -v container_command '%q ' "${invocation[@]}"
  "${invocation[@]}"
}
smoke() {
  local name=$1 emulated=$2 status
  shift 2
  if check "$name" "$@"; then return; else status=$?; fi
  if [[ $emulated = true ]] && grep -Eqi 'illegal instruction|AVX|SIGILL|qemu: uncaught target signal 4' "$run/logs/$name.log"; then
    # Keep the attempted command and failure log, but do not call an emulator
    # limitation a pass or hide a real application failure.
    node - "$report" "$name" <<'JS'
const fs = require('node:fs'); const [path, name] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(path));
const check = report.checks.findLast(check => check.name === name);
check.result = 'not verified locally';
check.detail = 'x64 emulation limitation (illegal instruction or missing AVX support); see attempt log.';
fs.writeFileSync(path, JSON.stringify(report, null, 2)+'\n');
JS
  else return "$status"; fi
}
for node in 22 24; do
  check "package-linux-node-$node" container_check linux/arm64 "$node" package "arex-research-cli-$version.tgz"
  for platform in macos windows; do
    record "package-$platform-node-$node" "node scripts/check-release.mjs --package files/arex-research-cli-$version.tgz --expected-version $version --sums SHA256SUMS" 'not verified locally' "The local package matrix covers Linux containers only; $platform requires the hosted workflow." ''
  done
done
smoke binary-linux-arm64 false container_check linux/arm64 22 binary arex-linux-arm64
smoke binary-linux-x64 true container_check linux/amd64 22 binary arex-linux-x64
if [[ $(uname -s) = Darwin && $(uname -m) = arm64 ]]; then
  check binary-darwin-arm64 node scripts/check-release.mjs --binary "$files/arex-darwin-arm64" --expected-version "$version" --sums "$run/SHA256SUMS"
  # Use an official x64 Node 22 to drive the unchanged checker under Rosetta.
  node_version=$(node -p process.version)
  archive="node-$node_version-darwin-x64.tar.gz"
  mkdir -p "$run/tools"
  if [[ ! -x $run/tools/node-$node_version-darwin-x64/bin/node ]]; then
    check rosetta-node-download curl -fSL "https://nodejs.org/dist/$node_version/$archive" -o "$run/tools/$archive"
    check rosetta-node-checksums curl -fSL "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$run/tools/SHASUMS256.txt"
    (cd "$run/tools" && grep "  $archive\$" SHASUMS256.txt > node-SHA256SUMS && sums --check node-SHA256SUMS)
    record rosetta-node-integrity "shasum -a 256 --check tools/node-SHA256SUMS" passed '' ''
    check rosetta-node-extract tar -xzf "$run/tools/$archive" -C "$run/tools"
  fi
  smoke binary-darwin-x64 true arch -x86_64 "$run/tools/node-$node_version-darwin-x64/bin/node" scripts/check-release.mjs --binary "$files/arex-darwin-x64" --expected-version "$version" --sums "$run/SHA256SUMS"
else
  for asset in arex-darwin-arm64 arex-darwin-x64; do
    record "binary-$asset" "node scripts/check-release.mjs --binary files/$asset --expected-version $version --sums SHA256SUMS" 'not verified locally' 'Requires an arm64 Mac with Rosetta.' ''
  done
fi
record binary-windows-x64 "node scripts/check-release.mjs --binary files/arex-windows-x64.exe --expected-version $version --sums SHA256SUMS" 'not verified locally' 'Windows is not available locally; use the hosted workflow.' ''
check final-artifact-integrity verify_files
node - "$report" <<'JS'
const fs = require('node:fs'); const path = process.argv[2];
const report = JSON.parse(fs.readFileSync(path));
report.verificationStatus = 'passed';
fs.writeFileSync(path, JSON.stringify(report, null, 2)+'\n');
JS
if [[ $publish = false ]]; then
  echo 'Checks complete; nothing published. Consult report.json for platforms not verified locally.'
  exit 0
fi
[[ -t 0 && -t 1 ]] || { echo 'Publishing requires an interactive terminal.' >&2; exit 1; }
printf 'Some platforms are not verified locally; review %s before publishing.\n' "$report"
read -r -p "Type $version to publish exactly these checked files: " confirmation
[[ $confirmation = "$version" ]] || { echo 'Publication cancelled.' >&2; exit 1; }
# These commands retain the terminal: npm uses the existing login and prompts
# for its own OTP. No token is read, stored, or supplied by this script.
if ! npm whoami --registry https://registry.npmjs.org/; then
  echo 'Run npm login, then rerun this script; the checked files will be reused.' >&2
  exit 1
fi
check pre-publish-integrity verify_files
if npm publish "$files/arex-research-cli-$version.tgz" --access public --ignore-scripts --registry https://registry.npmjs.org/; then
  record publish-npm "npm publish files/arex-research-cli-$version.tgz --access public --ignore-scripts --registry https://registry.npmjs.org/" passed '' ''
else
  record publish-npm "npm publish files/arex-research-cli-$version.tgz --access public --ignore-scripts --registry https://registry.npmjs.org/" failed 'See interactive npm output' ''
  exit 1
fi
check pre-release-integrity verify_files
# Only upload entries that were hashed and checked, never extra local files.
assets=()
while read -r _hash name; do assets+=("$files/$name"); done < "$run/SHA256SUMS"
if gh release create "$version" "${assets[@]}" "$run/SHA256SUMS" --repo "$repository" --target "$sha" --title "$version" --notes-file "$run/notes.md"; then
  record publish-github "gh release create $version checked-files SHA256SUMS --repo $repository --target $sha --title $version --notes-file notes.md" passed '' ''
else
  record publish-github "gh release create $version checked-files SHA256SUMS --repo $repository --target $sha --title $version --notes-file notes.md" failed 'See interactive gh output' ''
  exit 1
fi
