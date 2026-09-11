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
for tool in git vp cargo rustc clang-19 clang++-19 pkg-config flock; do
    command -v "$tool" >/dev/null || fail "Missing $tool. See docs/spy/README.md for WSL build setup."
done
pkg-config --exists libsecret-1 || fail 'Install libsecret-1-dev before building.'

source_repo=$(realpath "$source_repo")
output_dir=$(realpath "$output_dir")
build_dir=$(realpath -m "$build_dir")
[[ "$build_dir" != "$source_repo" && "$build_dir" != /mnt/* ]] || fail 'Use a separate checkout in the Linux filesystem.'
[[ -s "$output_dir/linux-build.env" ]] || fail 'Missing public Connect build settings.'
artifact_name="T3-Code-$version-x86_64.AppImage"
[[ ! -e "$output_dir/$artifact_name" ]] || fail 'The output directory already contains this AppImage.'

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
unset GITHUB_REPOSITORY T3CODE_DESKTOP_UPDATE_REPOSITORY
unset T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_CLERK_CLI_OAUTH_CLIENT_ID T3CODE_RELAY_URL
export T3CODE_DESKTOP_VERSION="$version" T3CODE_DESKTOP_ARCH=x64
export T3CODE_DESKTOP_SKIP_BUILD=false T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_MOCK_UPDATES=false

# Reuse downloaded dependencies, but always install against the selected source's
# lockfile and build fresh bundles. Keep packaging IO on the Linux filesystem too.
mkdir -p release
linux_output=$(mktemp -d "$build_dir/release/spy-release.XXXXXXXX")
export T3CODE_DESKTOP_OUTPUT_DIR="$linux_output"
vp env install
vp install --frozen-lockfile
vp run dist:desktop:linux
[[ $(git rev-parse HEAD) == "$commit" && -z $(git status --porcelain --untracked-files=normal) ]] || fail 'Linux source changed during the build.'
[[ -s "$linux_output/$artifact_name" ]] || fail 'Linux build did not produce the expected AppImage.'
cp "$linux_output/$artifact_name" "$output_dir/$artifact_name"
cmp "$linux_output/$artifact_name" "$output_dir/$artifact_name"
printf 'Linux AppImage ready: %s\n' "$output_dir/$artifact_name"
