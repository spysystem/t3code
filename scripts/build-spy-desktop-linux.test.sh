#!/usr/bin/env bash
# Run in the configured WSL distribution. Real Git/checkouts, fake expensive builds.
set -euo pipefail
helper=$(realpath "$(dirname "$0")/build-spy-desktop-linux.sh")
fixture=$(mktemp -d /tmp/spy-linux-release-tests.XXXXXXXX)
trap 'case "$fixture" in /tmp/spy-linux-release-tests.*) rm -rf -- "$fixture" ;; esac' EXIT
source_repo="$fixture/source checkout's files"
build_dir="$fixture/Linux checkout's files"
mkdir -p "$source_repo" "$fixture/bin"
git init -q "$source_repo"
git -C "$source_repo" config user.name 'Release test'
git -C "$source_repo" config user.email 'release-test@example.com'
printf '.env\n.env.local\nnode_modules/\nrelease/\n' > "$source_repo/.gitignore"
printf 'first source\n' > "$source_repo/source.txt"
git -C "$source_repo" add .
git -C "$source_repo" commit -qm first
first_commit=$(git -C "$source_repo" rev-parse HEAD)
printf 'second source\n' > "$source_repo/source.txt"
git -C "$source_repo" commit -qam second
second_commit=$(git -C "$source_repo" rev-parse HEAD)

cat > "$fixture/bin/vp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ $1 == env ]]; then exit 0; fi
if [[ $1 == install ]]; then
    [[ $2 == --frozen-lockfile ]]
    [[ ${SPY_LINUX_TEST_SCENARIO:-} != install-failed ]]
    exit
fi
[[ $1 == run && $2 == dist:desktop:linux ]]
[[ $CC == clang-19 && $CXX == clang++-19 ]]
[[ $T3CODE_DESKTOP_SKIP_BUILD == false && $T3CODE_DESKTOP_ARCH == x64 ]]
[[ $T3CODE_DESKTOP_SIGNED == false && $T3CODE_DESKTOP_MOCK_UPDATES == false ]]
[[ -z ${GITHUB_REPOSITORY:-} && -z ${T3CODE_DESKTOP_UPDATE_REPOSITORY:-} ]]
[[ -z ${T3CODE_CLERK_JWT_TEMPLATE:-} ]]
case ${SPY_LINUX_TEST_SCENARIO:-} in
    build-failed) exit 1 ;;
    missing-artifact) exit 0 ;;
    changed-source) printf 'changed during build\n' >> source.txt ;;
esac
{
    git rev-parse HEAD
    printf '%s\n' "$T3CODE_DESKTOP_VERSION"
    cat source.txt
} > "$T3CODE_DESKTOP_OUTPUT_DIR/T3-Code-$T3CODE_DESKTOP_VERSION-x86_64.AppImage"
SH
chmod +x "$fixture/bin/vp"
export PATH="$fixture/bin:$PATH"
export GITHUB_REPOSITORY=upstream/project T3CODE_DESKTOP_UPDATE_REPOSITORY=upstream/project
export T3CODE_DESKTOP_SKIP_BUILD=true T3CODE_CLERK_JWT_TEMPLATE=ambient
version=0.0.41-spy.1
artifact="T3-Code-$version-x86_64.AppImage"

new_output() {
    output_dir=$(mktemp -d "$fixture/output.XXXXXXXX")
    printf 'T3CODE_CLERK_JWT_TEMPLATE=release-fixture\n' > "$output_dir/linux-build.env"
}
run_build() {
    bash "$helper" "$source_repo" "$1" "$version" "$output_dir" "$build_dir" > "$fixture/run.log" 2>&1
}
expect_failure() {
    if run_build "$second_commit"; then
        printf 'Expected failure: %s\n' "$1" >&2
        exit 1
    fi
    grep -q "$1" "$fixture/run.log" || { cat "$fixture/run.log"; exit 1; }
    [[ ! -e "$output_dir/$artifact" ]]
}

new_output
run_build "$first_commit" || { cat "$fixture/run.log"; exit 1; }
[[ $(head -n 1 "$output_dir/$artifact") == "$first_commit" ]]
grep -q 'first source' "$output_dir/$artifact"
cmp "$output_dir/linux-build.env" "$build_dir/.env"
mkdir -p "$build_dir/node_modules"
touch "$build_dir/node_modules/cache-marker"
printf 'PASS: exact commit, source/output paths with spaces and apostrophes, isolated settings\n'

new_output
run_build "$second_commit" || { cat "$fixture/run.log"; exit 1; }
[[ $(head -n 1 "$output_dir/$artifact") == "$second_commit" ]]
[[ -e "$build_dir/node_modules/cache-marker" ]]
printf 'PASS: refresh cached checkout to the selected commit\n'

new_output
printf 'preserve me\n' > "$build_dir/untracked-work.txt"
expect_failure 'local changes'
[[ $(cat "$build_dir/untracked-work.txt") == 'preserve me' ]]
rm "$build_dir/untracked-work.txt"
printf 'PASS: dirty checkout preserved\n'

new_output
touch "$build_dir/.env.local"
expect_failure '.env.local'
rm "$build_dir/.env.local"

new_output
exec 8>"$build_dir.lock"
flock -n 8
expect_failure 'Another release'
flock -u 8
exec 8>&-
printf 'PASS: concurrent build refused\n'

new_output
printf 'existing artifact\n' > "$output_dir/$artifact"
if run_build "$second_commit"; then exit 1; fi
grep -q 'already contains this AppImage' "$fixture/run.log"
[[ $(cat "$output_dir/$artifact") == 'existing artifact' ]]
printf 'PASS: existing artifact preserved\n'

for scenario in install-failed build-failed missing-artifact changed-source; do
    new_output
    export SPY_LINUX_TEST_SCENARIO=$scenario
    if run_build "$second_commit"; then
        printf 'Expected failure: %s\n' "$scenario" >&2
        exit 1
    fi
    [[ ! -e "$output_dir/$artifact" ]]
    printf 'PASS: no exported artifact for %s\n' "$scenario"
done
unset SPY_LINUX_TEST_SCENARIO
