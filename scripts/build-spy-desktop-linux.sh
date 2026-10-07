#!/usr/bin/env bash
# Called by publish-spy-desktop.ps1 inside WSL. All source paths are Linux paths.
set -euo pipefail

source_repo=$1
commit=$2
version=$3
output_dir=$4
build_dir=${5:-"$HOME/build/t3code-linux"}

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail 'Expected a full source commit.'
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-spy\.[0-9]+$ ]] || fail 'Expected a SPY release version.'
[[ $(uname -m) == x86_64 ]] || fail 'The Linux release requires an x64 WSL distribution.'
for tool in git vp cargo rustc clang-19 clang++-19 pkg-config flock rpmbuild; do
    command -v "$tool" >/dev/null || fail "Missing $tool. See docs/spy/releasing.md for WSL build setup."
done
pkg-config --exists libsecret-1 || fail 'Install libsecret-1-dev before building.'

source_repo=$(realpath "$source_repo")
output_dir=$(realpath "$output_dir")
build_dir=$(realpath -m "$build_dir")
[[ "$build_dir" != "$source_repo" && "$build_dir" != /mnt/* ]] || fail 'Use a separate checkout in the Linux filesystem.'
[[ -s "$output_dir/linux-build.env" ]] || fail 'Missing public Connect build settings.'
# The .deb and .rpm feed the fork's apt and dnf repositories (spysystem/t3code-packages).
artifacts=("T3-Code-$version-x86_64.AppImage" "T3-Code-$version-amd64.deb" "T3-Code-$version-x86_64.rpm")
for artifact in "${artifacts[@]}"; do
    [[ ! -e "$output_dir/$artifact" ]] || fail "The output directory already contains $artifact."
done

mkdir -p "$(dirname "$build_dir")"
exec 9>"$build_dir.lock"
flock -n 9 || fail "Another release is using $build_dir."
if [[ ! -e "$build_dir" ]]; then
    git clone --no-local --depth 1 "$source_repo" "$build_dir"
fi
cd "$build_dir"
[[ $(git rev-parse --show-toplevel) == "$build_dir" ]] || fail 'The build directory must be its own Git checkout.'
[[ -z $(git status --porcelain --untracked-files=normal) ]] || fail 'The Linux build checkout has local changes; preserve them before releasing.'
[[ ! -e .env.local ]] || fail 'Remove or preserve .env.local outside the build checkout before releasing.'
git fetch --no-tags --depth 1 "$source_repo" "$commit"
git checkout --detach "$commit"
[[ $(git rev-parse HEAD) == "$commit" ]] || fail 'Linux source does not match the release commit.'
cp "$output_dir/linux-build.env" .env
chmod 600 .env

# GCC 12 cannot compile Electron 44's V8 headers. Scope Clang to this build;
# leave the distribution's compiler defaults and system packages alone.
export CC=clang-19 CXX=clang++-19
export TMPDIR=/tmp TMP=/tmp TEMP=/tmp
# A publish config makes electron-builder write resources/package-type into the
# .deb and .rpm, which the update notice reads. SPY's manual update mode never
# uses the app-update.yml it also adds.
unset GITHUB_REPOSITORY
export T3CODE_DESKTOP_UPDATE_REPOSITORY=spysystem/t3code
unset T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_CLERK_CLI_OAUTH_CLIENT_ID T3CODE_RELAY_URL
export T3CODE_DESKTOP_VERSION="$version" T3CODE_DESKTOP_ARCH=x64
export T3CODE_DESKTOP_SKIP_BUILD=false T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_MOCK_UPDATES=false

# Reuse downloaded dependencies, but always install against the selected source's
# lockfile and build fresh bundles. Keep packaging IO on the Linux filesystem too.
mkdir -p release
linux_output=$(mktemp -d "$build_dir/release/spy-release.XXXXXXXX")
export T3CODE_DESKTOP_OUTPUT_DIR="$linux_output"
vp env install
# CI lets pnpm replace node_modules without a TTY when a dependency upgrade requires it.
CI=true vp install --frozen-lockfile
vp run dist:desktop:linux
[[ $(git rev-parse HEAD) == "$commit" && -z $(git status --porcelain --untracked-files=normal) ]] || fail 'Linux source changed during the build.'
for artifact in "${artifacts[@]}"; do
    [[ -s "$linux_output/$artifact" ]] || fail "Linux build did not produce the expected $artifact."
done
for artifact in "${artifacts[@]}"; do
    cp "$linux_output/$artifact" "$output_dir/$artifact"
    cmp "$linux_output/$artifact" "$output_dir/$artifact"
    printf 'Linux artifact ready: %s\n' "$output_dir/$artifact"
done
