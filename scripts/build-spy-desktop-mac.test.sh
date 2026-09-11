#!/usr/bin/env bash
# Run with bash on Linux or WSL. Real Git/checkouts, faked macOS tools and builds.
set -euo pipefail
helper=$(realpath "$(dirname "$0")/build-spy-desktop-mac.sh")
fixture=$(mktemp -d /tmp/spy-mac-release-tests.XXXXXXXX)
trap 'case "$fixture" in /tmp/spy-mac-release-tests.*) rm -rf -- "$fixture" ;; esac' EXIT
source_repo="$fixture/source checkout's files"
build_dir="$fixture/Mac checkout's files"
mkdir -p "$source_repo" "$fixture/bin"
git init -q "$source_repo"
git -C "$source_repo" config user.name 'Release test'
git -C "$source_repo" config user.email 'release-test@example.com'
printf '.env\nnode_modules/\nrelease/\n' > "$source_repo/.gitignore"
printf 'T3CODE_CLERK_JWT_TEMPLATE=release-fixture\n' > "$source_repo/.env.example"
for build in 1 2; do
    printf 'source %s\n' "$build" > "$source_repo/source.txt"
    git -C "$source_repo" add .
    git -C "$source_repo" commit -qm "build $build"
    git -C "$source_repo" tag "spy-v0.0.41-spy.$build"
done
printf 'unreleased\n' > "$source_repo/source.txt"
git -C "$source_repo" commit -qam unreleased

# The script always fetches from GitHub; point that URL at the fixture instead.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$source_repo.insteadOf"
export GIT_CONFIG_VALUE_0=https://github.com/spysystem/t3code.git
export T3CODE_MAC_BUILD_DIR="$build_dir"

stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$fixture/bin/$1"; chmod +x "$fixture/bin/$1"; }
stub uname '[[ $1 == -s ]] && echo Darwin || echo "${SPY_MAC_TEST_ARCH:-arm64}"'
stub xcode-select 'echo /Library/Developer/CommandLineTools'
stub cargo 'exit 0'
stub curl 'printf "{\n  \"url\": \"x\",\n  \"tag_name\": \"spy-v0.0.41-spy.2\",\n  \"name\": \"y\"\n}\n"'
stub lsappinfo 'echo "${SPY_MAC_TEST_RUNNING:-}"'
stub hdiutil 'echo "unexpected hdiutil" >&2; exit 1'
stub vp '
set -euo pipefail
if [[ $1 == env ]]; then exit 0; fi
if [[ $1 == install ]]; then [[ $2 == --frozen-lockfile ]]; exit; fi
[[ $1 == run && $2 == dist:desktop:dmg:arm64 ]]
[[ $T3CODE_DESKTOP_SKIP_BUILD == false && $T3CODE_DESKTOP_ARCH == arm64 ]]
[[ $T3CODE_DESKTOP_SIGNED == false && $T3CODE_DESKTOP_MOCK_UPDATES == false ]]
[[ -z ${GITHUB_REPOSITORY:-} && -z ${T3CODE_DESKTOP_UPDATE_REPOSITORY:-} ]]
[[ -z ${T3CODE_CLERK_JWT_TEMPLATE:-} ]]
grep -q release-fixture .env
[[ ${SPY_MAC_TEST_SCENARIO:-} != missing-artifact ]] || exit 0
{ printf "%s\n" "$T3CODE_DESKTOP_VERSION"; cat source.txt; } > "$T3CODE_DESKTOP_OUTPUT_DIR/T3-Code-$T3CODE_DESKTOP_VERSION-arm64.dmg"'
export PATH="$fixture/bin:$PATH"
export GITHUB_REPOSITORY=upstream/project T3CODE_DESKTOP_UPDATE_REPOSITORY=upstream/project
export T3CODE_DESKTOP_SKIP_BUILD=true T3CODE_CLERK_JWT_TEMPLATE=ambient

run_build() { (cd "$fixture" && bash "$helper" "$@") > "$fixture/run.log" 2>&1; }
built_dmg() { sed -n 's/^DMG ready: //p' "$fixture/run.log"; }
expect_failure() {
    local message=$1
    shift
    if run_build "$@"; then
        printf 'Expected failure: %s\n' "$message" >&2
        exit 1
    fi
    grep -q "$message" "$fixture/run.log" || { cat "$fixture/run.log"; exit 1; }
}

run_build || { cat "$fixture/run.log"; exit 1; }
dmg=$(built_dmg)
[[ $(head -n 1 "$dmg") == 0.0.41-spy.2 && $(tail -n 1 "$dmg") == 'source 2' ]]
[[ $dmg == "$build_dir/release/spy-0.0.41-spy.2."*/T3-Code-0.0.41-spy.2-arm64.dmg ]]
mkdir -p "$build_dir/node_modules"
touch "$build_dir/node_modules/cache-marker"
printf 'PASS: latest published release, not the newest commit, with isolated settings\n'

run_build spy-v0.0.41-spy.1 || { cat "$fixture/run.log"; exit 1; }
[[ $(tail -n 1 "$(built_dmg)") == 'source 1' && -e "$build_dir/node_modules/cache-marker" ]]
printf 'PASS: explicit version reuses the cached checkout\n'

bash -s -- 0.0.41-spy.2 < "$helper" > "$fixture/run.log" 2>&1 || { cat "$fixture/run.log"; exit 1; }
[[ $(tail -n 1 "$(built_dmg)") == 'source 2' ]]
printf 'PASS: runs when piped into bash\n'

printf 'preserve me\n' > "$build_dir/untracked-work.txt"
expect_failure 'local changes'
[[ $(cat "$build_dir/untracked-work.txt") == 'preserve me' ]]
rm "$build_dir/untracked-work.txt"
printf 'PASS: dirty checkout preserved\n'

expect_failure 'Not a SPY release version' v0.0.42
SPY_MAC_TEST_ARCH=x86_64 expect_failure 'Apple Silicon'
SPY_MAC_TEST_SCENARIO=missing-artifact expect_failure 'did not produce'
SPY_MAC_TEST_RUNNING='"T3 Code (SPY)" ASN:0x0-0x1234:' expect_failure 'Quit T3 Code' --install
printf 'PASS: refuses invalid versions, Rosetta, missing DMGs, and installing over a running app\n'
