#!/bin/sh
# AREX CLI installer.
#
#   curl -fsSL https://github.com/AREX-Research/arex-cli/releases/latest/download/install.sh | sh
#   ./install.sh              install the latest release
#   ./install.sh uninstall    remove it again
#
#   AREX_VERSION       release tag to install (default: the latest release)
#   AREX_INSTALL_DIR   destination directory (default: ~/.local/bin)
#
# Downloads the prebuilt binary from the public GitHub releases with curl and
# checks it against the release's SHA256SUMS; no GitHub account or CLI is
# needed. The binary needs glibc on Linux.
#
# POSIX sh on purpose. The installer has to read $SHELL to find the login
# shell whose startup file it should teach about PATH, so it must not impose
# a shell of its own. Prompts read /dev/tty, so `... | sh` stays interactive.

set -eu

REPO=AREX-Research/arex-cli
MARKER='# Added by the AREX CLI installer'
INSTALL_DIR=${AREX_INSTALL_DIR:-$HOME/.local/bin}

main() {
	case ${1:-install} in
	install) install ;;
	uninstall) uninstall ;;
	-h | --help | help) usage ;;
	*) die "Unknown command: $1. Use install or uninstall." ;;
	esac
}

usage() {
	cat <<'EOF'
AREX CLI installer.

  install.sh              install the latest release
  install.sh uninstall    remove it again

  AREX_VERSION       release tag to install (default: the latest release)
  AREX_INSTALL_DIR   destination directory (default: ~/.local/bin)
EOF
}

die() {
	echo "$@" >&2
	exit 1
}

# Asks a yes/no question on the terminal. Fails when there is no terminal,
# which is how a non-interactive run declines every optional change.
confirm() {
	{ exec 3<>/dev/tty; } 2>/dev/null || return 1
	printf '%s [y/N] ' "$1" >&3
	if read -r reply <&3; then
		exec 3>&-
	else
		exec 3>&-
		return 1
	fi
	case $reply in
	[Yy] | [Yy][Ee][Ss]) return 0 ;;
	*) return 1 ;;
	esac
}

asset_name() {
	os=$(uname -s)
	arch=$(uname -m)
	case $os in
	Darwin) os=darwin ;;
	Linux) os=linux ;;
	MINGW* | MSYS* | CYGWIN* | Windows_NT) echo arex-windows-x64.exe; return ;;
	*) die "Unsupported operating system: $os" ;;
	esac
	case $arch in
	arm64 | aarch64) arch=arm64 ;;
	x86_64 | amd64) arch=x64 ;;
	*) die "Unsupported architecture: $arch" ;;
	esac
	echo "arex-$os-$arch"
}

binary_name() {
	case $(asset_name) in
	*.exe) echo arex.exe ;;
	*) echo arex ;;
	esac
}

# The prebuilt binaries are linked against glibc and do not run on musl.
is_musl() {
	for f in /lib/ld-musl-*; do
		[ -e "$f" ] && return 0
	done
	case $(ldd --version 2>&1 || true) in
	*musl*) return 0 ;;
	esac
	return 1
}

cleanup() {
	[ -z "${tmp:-}" ] || rm -f "$tmp"
}

# Compares a download with the release's SHA256SUMS, so a corrupted or
# substituted file is never executed.
verify_checksum() {
	file=$1 name=$2 base=$3
	sums=$(curl -fsSL "$base/SHA256SUMS") || die "Download failed: $base/SHA256SUMS"
	expected=$(printf '%s\n' "$sums" | awk -v name="$name" '{ sub(/^\*/, "", $2) } $2 == name { print $1 }')
	[ -n "$expected" ] || die "The release has no checksum for $name."
	if command -v sha256sum >/dev/null 2>&1; then
		actual=$(sha256sum "$file" | cut -d ' ' -f 1)
	elif command -v shasum >/dev/null 2>&1; then
		actual=$(shasum -a 256 "$file" | cut -d ' ' -f 1)
	else
		die "sha256sum or shasum is required to verify the download."
	fi
	[ "$actual" = "$expected" ] || die "Checksum mismatch for $name; the download was discarded."
}

install() {
	if [ "$(uname -s)" = Linux ] && is_musl; then
		die "The standalone arex binary needs glibc and does not run on musl-based systems such as Alpine. Install with: npm install -g @arex-research/cli"
	fi
	command -v curl >/dev/null 2>&1 || die "curl is required to download arex. Install curl and try again."
	asset=$(asset_name)
	target="$INSTALL_DIR/$(binary_name)"
	if [ -n "${AREX_VERSION:-}" ]; then
		version=$AREX_VERSION
		base="https://github.com/$REPO/releases/download/$version"
	else
		version=latest
		base="https://github.com/$REPO/releases/latest/download"
	fi

	mkdir -p "$INSTALL_DIR"
	echo "Installing arex $version ($asset) to $target"

	# Download beside the target, verify, then rename: an interrupted or broken
	# download never replaces a working binary, and mv within one directory is
	# atomic.
	tmp=$(mktemp "$INSTALL_DIR/.arex-install.XXXXXX")
	trap cleanup EXIT
	trap 'exit 129' HUP
	trap 'exit 130' INT
	trap 'exit 143' TERM
	curl -fsSL "$base/$asset" -o "$tmp" || die "Download failed: $base/$asset"
	verify_checksum "$tmp" "$asset" "$base"
	chmod 755 "$tmp"
	"$tmp" --version >/dev/null 2>&1 || die "The downloaded binary did not run."
	mv "$tmp" "$target"

	ensure_on_path
	echo "Installed. Run: arex setup"
}

uninstall() {
	target="$INSTALL_DIR/$(binary_name)"
	if [ -e "$target" ]; then
		rm -f "$target"
		echo "Removed $target"
	else
		echo "Nothing to remove at $target"
	fi

	rc=$(shell_startup_file) || rc=
	if [ -n "$rc" ] && [ -f "$rc" ] && grep -q "^$MARKER" "$rc"; then
		if confirm "Remove the PATH entry this installer added to $rc?"; then
			tmp=$(mktemp)
			# Write back into the existing file rather than mv-ing over it:
			# dotfile managers symlink startup files, and mv would replace the
			# link with a regular file and reset its mode.
			if awk -v marker="$MARKER" '
				index($0, marker) == 1 { skip = 2 }
				skip > 0 { skip--; next }
				{ print }
			' "$rc" >"$tmp" && cat "$tmp" >"$rc"; then
				rm -f "$tmp"
			else
				rm -f "$tmp"
				die "Could not remove the PATH entry from $rc."
			fi
			echo "Removed the PATH entry from $rc. Open a new shell for it to take effect."
		fi
	fi
	echo "Your API key in ~/.config/arex and any installed Agent Skill were left alone."
}

# The startup file of the login shell, not of whichever shell runs this script.
shell_startup_file() {
	case $(basename "${SHELL:-}") in
	bash)
		if [ "$(uname -s)" = Darwin ]; then echo "$HOME/.bash_profile"; else echo "$HOME/.bashrc"; fi
		;;
	zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
	fish) echo "$HOME/.config/fish/config.fish" ;;
	*) return 1 ;;
	esac
}

# The line that adds INSTALL_DIR to PATH, with the directory quoted as a
# literal so characters such as $ or spaces in it are never evaluated.
path_line() {
	case $(basename "${SHELL:-}") in
	fish) printf "fish_add_path '%s'\n" "$(printf '%s' "$INSTALL_DIR" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")" ;;
	*) printf "export PATH='%s':\"\$PATH\"\n" "$(printf '%s' "$INSTALL_DIR" | sed "s/'/'\\\\''/g")" ;;
	esac
}

ensure_on_path() {
	case ":$PATH:" in
	*":$INSTALL_DIR:"*) return 0 ;;
	esac

	echo "$INSTALL_DIR is not on your PATH."
	if ! rc=$(shell_startup_file); then
		echo "Add it to your shell's startup file: $(path_line)"
		return 0
	fi
	if [ -f "$rc" ] && grep -qF "$(path_line)" "$rc"; then
		echo "$rc already adds it. Open a new shell to pick it up."
		return 0
	fi
	if ! confirm "Add it to $rc?"; then
		echo "Skipped. Add it yourself with: $(path_line)"
		return 0
	fi

	mkdir -p "$(dirname "$rc")"
	{
		echo ""
		echo "$MARKER on $(date +%Y-%m-%d). Remove with: install.sh uninstall"
		path_line
	} >>"$rc"
	echo "Added to $rc. Open a new shell, or run: $(path_line)"
}

main "$@"
