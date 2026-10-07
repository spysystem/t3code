# Releasing the SPY desktop app

Build, test, and publish procedures for the fork's desktop releases. Fork policy lives in
[the fork rules](README.md); release approval follows its Decisions section.

## Building the Windows desktop app

Run `.t3\build-desktop-win.cmd` from the repo root (the `.t3` folder is gitignored; recreate the
script from this section if it is missing). It loads the MSVC environment and runs
`vp run dist:desktop:win`. The installer lands in `release/`, also gitignored.

The normal release workflow has two steps. First, build a local Windows x64 and Linux x64
candidate from a clean, committed checkout:

```powershell
scripts\release-desktop.cmd
```

This command builds both platforms and prints the Windows installer and candidate directory.
It does not create a GitHub release, upload assets, or notify colleagues. Give the maintainer
the installer path and wait for them to install and test it. A request to build or sync upstream
is not approval to publish.

After the maintainer confirms testing and explicitly requests publication, push the candidate's
recorded source commit to `spy/main`, then publish that candidate directory:

```powershell
scripts\release-desktop.cmd --publish "C:\path\to\candidate-directory"
```

Publishing verifies the recorded hashes of the installers, Linux packages, checksums, and release notes, then
uploads those exact files without rebuilding. It uses the commit in `candidate.json`, even if
the checkout has since advanced. Keep the entire candidate directory until publication. If
code changes after testing, build a new version and test again. Each local build directory,
including an interrupted build, reserves its version on that machine. This keeps different
installers distinguishable during testing. Published versions may therefore skip suffixes;
an unpublished candidate does not need its own GitHub release.

The script uses upstream's `scripts/resolve-nightly-release.ts` resolver to choose the release
base for builds from `main`, then chooses the next `-spy.N` suffix from GitHub releases
(including drafts), remote tags, and local candidate directories. Upstream currently advances the patch version from
`apps/desktop/package.json`: package version `0.0.40` targets `0.0.41`, so our first build is
`0.0.41-spy.1`. Further builds increment the SPY suffix; when the nightly target becomes
`0.0.42`, numbering starts at `0.0.42-spy.1`. Upstream's package version can lag its nightly
release name, so it is not used directly as our release base. The script prints the selected
version before building. To see the next version without
building or publishing, run `scripts\release-desktop.cmd --next-version`; this also works with
uncommitted changes. A preview does not reserve a version. An explicit override remains available:
`scripts\release-desktop.cmd 0.0.41-spy.7`.

Authenticate GitHub CLI with `gh auth login` first. Building needs read access for version
selection and a clean local commit; pushing is only required before publication. Publishing
needs write access to `spysystem/t3code`. Every candidate builds fresh JS bundles, regardless
of an ambient skip-build setting.

The tracked `scripts\release-desktop.cmd` launcher invokes
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1`. Despite
the historical filename, the default is build-only. `--publish DIRECTORY` supplies
`-CandidateDirectory DIRECTORY`; `--next-version` supplies `-NextVersion`, and an explicit
version supplies `-Version VERSION`.
The candidate builder builds Linux in WSL, then calls `.t3\build-desktop-win.cmd` without arguments
for Windows. That local helper only builds Windows; it does not publish releases. When recreating
the helper, propagate the build exit code with `call vp run
dist:desktop:win` followed by `exit /b %errorlevel%`.

Prerequisites, all of which bit us once:

- Visual Studio 2022 with Desktop development with C++, the Windows SDK, and the
  **Spectre-mitigated libraries** (`Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`).
  Installing a component with `--passive` needs an elevated installer; exit code 5007 means it was
  not elevated, not that a reboot is pending.
- Rust with the `x86_64-pc-windows-msvc` target and **Cargo 1.85 or newer**; the resource monitor
  crate uses edition 2024.
- Python 3.
- The post-build self-containment check refuses to pass while a `node_modules` folder is visible
  from the temp directory, and `C:\Users\<you>\node_modules` counts. Point `TMP`/`TEMP` outside the
  profile; the script does this.
- `T3CODE_DESKTOP_SKIP_BUILD=1` reuses the JS artifacts when only packaging failed.

The Windows artifact is unsigned, so SmartScreen warns on first run. Packaged Windows and Linux x64
and Apple Silicon Mac builds with a
`-spy.N` version check the fork's latest published release after startup and every four hours.
Windows builds carry an electron-updater feed for `spysystem/t3code` (`T3CODE_DESKTOP_UPDATE_REPOSITORY`)
and use upstream's in-app download and restart-to-install flow, fixed to the stable track. The
updater reads `latest.yml` from the release GitHub marks latest and downloads the installer it
names, using the blockmaps for differential downloads; it skips signature verification because
the build names no publisher. Linux checks for a matching `.AppImage` asset; Macs only need the release,
because they rebuild it. Both offer a GitHub release link for manual updates, independently of
the electron-updater feed. Nothing downloads or installs without the user choosing to;
`T3CODE_DISABLE_AUTO_UPDATE` also disables these checks. Existing builds that report no configured
update feed or Windows-only checks need one manual upgrade to gain release checks, and Windows
builds that only link to GitHub need one manual upgrade to gain in-app updates. Installing replaces the upstream app:
same app id, same `t3code://` protocol handler, same state directory, so projects carry over.
WSL support is outside SPY's required scope. No Linux CLI runtime archive is supplied, so the WSL
backend does not start in these builds.

## Linux release builds through WSL2

The same `scripts\release-desktop.cmd` command builds an AppImage, a `.deb`, and an `.rpm` in the WSL2 **Debian** distribution. It
refreshes a separate checkout at `~/build/t3code-linux` from the exact local Windows source commit,
installs dependencies using the frozen lockfile, and builds fresh bundles with the same release
version. Linux dependencies and packaging output stay on the Linux filesystem; the completed
files are copied into the Windows release directory. The packages carry electron-builder's
`resources/package-type` marker because the build sets `T3CODE_DESKTOP_UPDATE_REPOSITORY`; SPY's
manual update mode still ignores the update feed that setting adds. Local changes in the Linux checkout
stop the release instead of being discarded. Concurrent builds using that checkout are rejected.

Set up Debian once with Node/Vite+ matching the repository, a current Rust toolchain, and:

```sh
sudo apt-get update
sudo apt-get install build-essential python3 git curl ca-certificates pkg-config libsecret-1-dev imagemagick libfuse2 clang-19 unzip xz-utils rpm
```

Clang 19 is selected for the Linux build because Debian 12's GCC 12 fails to compile the V8
headers bundled with Electron 44. Rust and Vite+ must be available in the user's login shell.
The candidate builder copies only the four public Connect settings from the Windows `.env`; it never
copies the reusable dev credential. Keep `.env.local` out of the managed build checkout.

For another configured distribution or checkout location, call the candidate builder directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -WslDistribution Debian -LinuxBuildDirectory /home/builder/build/t3code-linux
```

Each release checks prerequisites and installs the repository's declared JavaScript environment.
WSL/kernel, distro, and Rust/Vite+ upgrades are explicit maintenance operations; building does
not run system upgrades or restart WSL. A failed build on either platform stops publication.

## Apple Silicon Mac builds

Mac users build published releases on their own Mac; a Windows machine cannot build the DMG.
`scripts/build-spy-desktop-mac.sh` builds the latest published `spy-v*` release, or an explicit
version, in a separate checkout at `~/build/t3code-mac` (`T3CODE_MAC_BUILD_DIR` overrides it).
It never builds unreleased commits or touches the checkout it is run from. It copies
`.env.example` to `.env` for the public Connect settings, builds fresh bundles with the release
version, and with `--install` replaces `/Applications/T3 Code (SPY).app` after T3 Code has quit.
Local changes in the build checkout stop the build instead of being discarded. It runs without a
clone of the fork:

```sh
curl -fsSL https://raw.githubusercontent.com/spysystem/t3code/refs/heads/spy/main/scripts/build-spy-desktop-mac.sh | bash -s -- --install
```

Set up the Mac once with the Xcode Command Line Tools (`xcode-select --install`), Rust from
[rustup](https://rustup.rs) with `rustup target add aarch64-apple-darwin`, and [Vite+](https://viteplus.dev/guide/). The build's own
preflight names anything else that is missing. Locally built apps carry no quarantine flag, so
the unsigned app opens without a Gatekeeper prompt. The app's update check announces each newer
release; rerunning the command updates it. `scripts/build-spy-desktop-mac.test.sh` exercises the
script on Linux or WSL with faked macOS tools; only a real Mac proves the build. T3 Connect passkey
sign-in depends on the Mac identity question under Desktop distribution.

## Desktop distribution

After the maintainer has tested and approved a candidate, the explicit publish command uploads
its `.exe`, `.AppImage`, `.deb`, `.rpm`, the Windows update feed (`latest.yml` and the `.exe.blockmap`),
and `SHA256SUMS.txt` to a draft release in `spysystem/t3code`, then makes it public once the upload
succeeds. Installed Windows builds offer the release from that moment. The candidate builder
refuses a `latest.yml` whose version, installer name, or SHA-512 does not match the built installer. Each build uses a fresh
directory below `release/`; it never selects an installer from an earlier build. Release tags
start with `spy-v` so they do not trigger upstream's `v*.*.*` release workflow. Existing releases
are never overwritten. If upload or publication fails, inspect the draft on GitHub and finish
it there, or delete the incomplete draft and any associated tag before retrying the version.

Once the release is public, the publish command starts the `publish.yml` workflow in
[`spysystem/t3code-packages`](https://github.com/spysystem/t3code-packages). It rebuilds the
signed apt and dnf repositories at <https://spysystem.github.io/t3code-packages/> from the
newest release's `.deb`, `.rpm`, and `SHA256SUMS.txt`, and fails without deploying when a
package is missing or does not match. If the workflow cannot be started, the command exits
with an error after publication and prints the command to start it by hand; reruns are safe.
Publishing therefore also needs write access to `spysystem/t3code-packages`. Repository
signing, the key secret, and key replacement are described in that repository's README; keep
the key backup and revocation certificate outside GitHub.

Public notes contain only generic installation guidance and the source commit. Keep internal
configuration values, internal URLs, and colleague onboarding in private documentation; do not
bundle them in installers or include them in release notes. There is no current commitment to
paid signing services or CI builds.

The release targets are Windows x64 without a WSL backend and Linux x64 AppImage, `.deb`, and `.rpm`.
Fedora and Linux Mint install from the package repositories; CachyOS and other distributions use
the AppImage. Successful packaging does not claim desktop verification on those distributions. Apple Silicon Macs build releases locally (see above); a published, signed
Mac installer remains a future target. Intel Mac builds are outside scope.

If CI builds become useful, use a small manually triggered SPY release workflow building
`spy/main` into a draft GitHub Release. Upstream's release workflow also publishes its npm
package and deploys its websites, so it cannot be enabled unchanged for SPY. Code
synchronization with upstream remains a separate maintainer task; the updater only distributes
packaged SPY releases.

Windows updates stay unsigned; they need no signing subscription. The AppImage could use the
same updater without a paid signing service; verify installation and updates on CachyOS first.
Desktop releases include their bundled server; standalone `npx t3` servers still use upstream's
npm distribution and need a separate decision before supporting SPY updates.

The upstream winget package `T3Tools.T3Code` also claims SPY installs, because they share the
app id. Once upstream publishes a version that winget ranks above an installed `-spy.N` build,
`winget upgrade --all` may replace that build with upstream's app; exclude it with
`winget pin add --id T3Tools.T3Code`. A winget package for SPY releases would need either a
manifest pull request to Microsoft's catalog per release or a hosted REST source, and gives no
more than the in-app updater.

Signing costs discussed on 2026-09-11 are reference prices, not subscriptions we have approved:

| Platform | Signing option                                                                                             | Listed cost                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Windows  | [Azure Artifact Signing Basic](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku) | US$9.99/month, about US$120/year; recommended for trusted distribution, not required for the initial unsigned update path |
| macOS    | [Apple Developer Program](https://developer.apple.com/support/compare-memberships/)                        | US$99/year; reuse an existing SPY membership if available                                                                 |
| Linux    | AppImage distribution                                                                                      | No paid signing subscription required for this path                                                                       |

Recheck prices, local billing, and eligibility before purchase. These are account/service costs,
not per-installation fees. Mac automatic updates require signing, and normal distribution also
needs notarization; see [Electron Builder's update requirements](https://www.electron.build/v26/docs/features/auto-update/).
Mac native passkeys additionally require SPY's Apple team/app identity to be associated with
upstream's Clerk configuration, which SPY does not control. Resolve that authentication path
before claiming full Mac support; see [desktop passkeys](../operations/connect-setup.md#desktop-passkeys).
