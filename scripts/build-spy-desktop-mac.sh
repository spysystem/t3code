#!/usr/bin/env bash
# Builds a published SPY desktop release on an Apple Silicon Mac and optionally installs it.
# Works from a fork checkout or straight from GitHub; see the macOS section of docs/spy/README.md.
set -euo pipefail

readonly REPO_URL=https://github.com/spysystem/t3code.git
readonly LATEST_RELEASE_API=https://api.github.com/repos/spysystem/t3code/releases/latest
readonly APP_NAME='T3 Code (SPY).app'

usage() {
    cat <<'EOF'
Usage: build-spy-desktop-mac.sh [--install] [VERSION]

Builds the latest published SPY release, or VERSION (for example 0.0.43-spy.9),
as an unsigned Apple Silicon DMG. --install replaces /Applications/T3 Code (SPY).app.
Builds in ~/build/t3code-mac, or T3CODE_MAC_BUILD_DIR, never in the current checkout.
EOF
}

fail() { printf '%s\n' "$*" >&2; exit 1; }

install_app() {
    local dmg=$1 mount_point
    # The SPY and upstream apps share this bundle id and state directory.
    [[ -z $(lsappinfo find bundleid=com.t3tools.t3code) ]] ||
        fail "Quit T3 Code, then rerun with --install or open '$dmg'."
    mount_point=$(mktemp -d)
    hdiutil attach -nobrowse -readonly -mountpoint "$mount_point" "$dmg" >/dev/null
    [[ -d "$mount_point/$APP_NAME" ]] || { hdiutil detach -quiet "$mount_point"; fail "The DMG does not contain $APP_NAME."; }
    rm -rf "/Applications/$APP_NAME"
    ditto "$mount_point/$APP_NAME" "/Applications/$APP_NAME"
    hdiutil detach -quiet "$mount_point"
    xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true
    printf 'Installed /Applications/%s\n' "$APP_NAME"
}

main() {
    local install=false version=""
    while (($#)); do
        case $1 in
            --install) install=true ;;
            -h | --help) usage; return 0 ;;
            -*) usage >&2; fail "Unknown option: $1" ;;
            *) [[ -z $version ]] || fail 'Pass at most one version.'; version=$1 ;;
        esac
        shift
    done
    local build_dir=${T3CODE_MAC_BUILD_DIR:-"$HOME/build/t3code-mac"}

    [[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] ||
        fail 'Run this natively on an Apple Silicon Mac (not under Rosetta).'
    xcode-select -p >/dev/null 2>&1 || fail 'Install the Xcode Command Line Tools: xcode-select --install'
    for tool in git curl vp cargo; do
        command -v "$tool" >/dev/null || fail "Missing $tool. See the macOS section of docs/spy/README.md."
    done

    if [[ -z $version ]]; then
        version=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$LATEST_RELEASE_API" |
            grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
        [[ -n $version ]] || fail 'Could not look up the latest SPY release on GitHub.'
    fi
    version=${version#spy-v}
    [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+-spy\.[0-9]+$ ]] || fail "Not a SPY release version: $version"
    local tag="spy-v$version" dmg_name="T3-Code-$version-arm64.dmg"
    printf 'Building SPY release %s\n' "$version"

    # A dedicated checkout keeps the build away from any work in the caller's clone.
    [[ -e $build_dir ]] || { mkdir -p "$build_dir"; git init -q "$build_dir"; }
    cd "$build_dir"
    [[ $(git rev-parse --show-toplevel) == "$(pwd -P)" ]] || fail "$build_dir must be its own Git checkout."
    [[ -z $(git status --porcelain --untracked-files=normal) ]] ||
        fail "$build_dir has local changes; preserve or remove them before building."
    git fetch --depth 1 --no-tags "$REPO_URL" tag "$tag"
    git checkout -q --detach "$tag"
    # The example file carries the public T3 Connect identifiers used by release builds.
    cp .env.example .env

    unset GITHUB_REPOSITORY T3CODE_DESKTOP_UPDATE_REPOSITORY
    unset T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_CLERK_CLI_OAUTH_CLIENT_ID T3CODE_RELAY_URL
    export T3CODE_DESKTOP_VERSION="$version" T3CODE_DESKTOP_ARCH=arm64
    export T3CODE_DESKTOP_SKIP_BUILD=false T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_MOCK_UPDATES=false
    mkdir -p release
    local output_dir
    output_dir=$(mktemp -d "$build_dir/release/spy-$version.XXXXXXXX")
    export T3CODE_DESKTOP_OUTPUT_DIR="$output_dir"

    # Builds must not read the rest of this script when it is piped into bash.
    vp env install </dev/null
    vp install --frozen-lockfile </dev/null
    vp run dist:desktop:dmg:arm64 </dev/null
    [[ -s "$output_dir/$dmg_name" ]] || fail "The build did not produce $dmg_name."
    printf 'DMG ready: %s\n' "$output_dir/$dmg_name"

    if $install; then install_app "$output_dir/$dmg_name"; fi
}

# Parsed in full before running, so a checkout or pipe cannot change the script mid-run.
main "$@"; exit
