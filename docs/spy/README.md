# SPY fork of T3 Code

This repository is SPY's fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Read
this before changing anything; the upstream `AGENTS.md` still applies for how the code works.

## Decisions

- **No upstream pull requests from this fork.** Our changes are product decisions upstream has
  declined or not made. Do not open PRs against `pingdotgg/t3code` unless a maintainer asks.
- **We borrow upstream's T3 Connect.** The root `.env` (gitignored, copied from `.env.example`)
  carries their public Clerk key and relay URL. It must exist on any machine that builds a
  release, or Connect is silently disabled in the artifact. We do not run our own relay.
- **Mobile clients are outside our release control.** Users run upstream's store apps; this fork
  cannot ship updates to them. Server changes must keep those installed clients working. Editing
  `apps/mobile` does not update the app our users run. See Mobile compatibility below.
- **Desktop releases are unsigned local Windows and Linux x64 builds**, published to public GitHub Releases
  after local installation and testing of a candidate. Building is the default; publishing the
  exact tested files requires a separate maintainer request. Packaged Windows and Linux x64 builds check for SPY releases and link to
  GitHub for manual download; automatic installation stays off. Signing
  subscriptions and CI builds are deferred. See Desktop distribution below.

## Mobile compatibility

Treat the installed upstream mobile app as an external client that can lag behind our server.
Fork features must work without requiring a mobile update or a forked mobile build.

- Preserve existing wire shapes and behavior. Optional fields and new RPC methods can be
  compatible; adding a value to an existing enum is not automatically compatible. For example,
  a new message role can make an older client reject the entire thread and stay stuck syncing.
- Send incompatible feature data only after that client explicitly opts in. An absent capability
  means legacy behavior. Provide a server-side fallback that preserves normal messages and
  synchronization progress, including event sequences and pagination watermarks.
- Cover HTTP snapshots and older history pages, WebSocket initial snapshots, live events, and
  reconnect replay. Apply the same compatibility behavior to direct and T3 Connect connections.
- Verify changed wire data against the previous client contract. Tests and type checks using
  only the updated mobile source do not prove compatibility with installed mobile apps.

## Keeping up with upstream

`origin` is `spysystem/t3code`, `upstream` is `pingdotgg/t3code`. Keep `spy/main` as a short,
linear commit stack on upstream `main`. Fetch upstream before starting fork work and rebase
onto its latest `main` before finalizing the stack. Keep local `main` aligned by fast-forward;
preserve and investigate any unique local commits.

### Commit ownership

- The first fork commit is `chore(spy): branding and fork rules`. It owns SPY branding,
  fork-wide agent instructions, and fork maintenance/build guidance. Fold updates to these
  concerns into this foundation commit.
- Every subsequent commit owns exactly one feature, including its implementation, tests, and
  user documentation. Keep features in dependency order, with independent features isolated.
- Fold a feature's bug fixes, adjustments, expansions, and upstream compatibility fixes into
  its existing commit. Rewrite its title and body to describe the resulting feature when its
  scope changes. Split work touching multiple features by owner before folding it in.
- Temporary `fixup!` commits are useful while working; autosquash them before handing off or
  publishing. The finished stack has one foundation commit and exactly one commit per feature,
  with no merge commits or separate follow-up fixes. Commit identities change during rebases;
  identify owners by subject and diff, not hashes stored in documentation.

### Keep the fork small

- Prefer upstream behavior and existing extension points. Keep SPY-specific behavior in focused
  modules with small integration changes to upstream files where practical.
- Keep each feature's diff limited to what it needs. Preserve upstream naming, layout, and
  formatting around those changes; keep unrelated refactors out of the feature.
- When upstream implements the same behavior, use it and drop the redundant fork change after
  verifying our requirements. Resolve upstream conflicts in the owning feature commit.

### Keep colleague documentation current

When adding, changing, or removing a user-facing fork feature, configuration option, or
installation/update workflow, update `developer/internal/t3-code/t3-code.md` in the private
`spy-documentation` repository as part of the same task. Check the guide against the features
being shipped before each release. Internal refactors that do not change usage need no guide edit.

Keep internal URLs and team-specific configuration values in that private guide. Public feature
docs use generic examples; this README owns fork maintenance and release procedures. In the
handoff, report the private guide update or why none was needed. If the private repository is
unavailable, report the outstanding documentation work instead of silently skipping it.

### Rewriting the stack

1. Inspect status, linked worktrees, stashes, and both remotes. Record the old tip, upstream base,
   and remote fork tip. Account for remote work absent locally before rewriting. Create a named
   backup branch and preserve unfinished work, including untracked files and the staged split.
2. Rebase the fork onto the fetched `upstream/main`; use rebase rather than merge for upstream
   updates. For changes to an existing feature, find its current commit with
   `git log --reverse --oneline upstream/main..HEAD`, stage only that owner's changes, and run:

   ```sh
   git commit --fixup=<owning-commit>
   git rebase -i --autosquash upstream/main
   ```

   Use the same process for foundation changes. A genuinely new feature gets a new commit.
   Keep unrelated unfinished work preserved until the rewrite is complete.

3. Compare the old and new stacks with `git range-diff` using their respective upstream bases.
   Account for every feature and inspect the final diff. For history-only cleanup, verify the
   final source tree is unchanged. Run focused checks for code changes and conflict resolutions,
   following `AGENTS.md`; restore and verify unfinished work.
4. Verify that upstream is an ancestor, the foundation is first, and each feature has exactly one
   commit. Report the recovery ref and check results. Publishing requires a maintainer request;
   when requested, use `--force-with-lease` tied to the inspected remote fork tip. Investigate a
   failed lease before retrying.

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

Publishing verifies the recorded hashes of both installers, checksums, and release notes, then
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

The Windows artifact is unsigned, so SmartScreen warns on first run. Packaged Windows and Linux x64 builds with a
`-spy.N` version check the fork's latest published release after startup and every four hours.
They check for a matching `.exe` or `.AppImage` asset and offer a GitHub release link for manual
download, independently of the electron-updater feed.
No automatic download or installation is enabled; `T3CODE_DISABLE_AUTO_UPDATE` also disables
these checks. Existing builds that report no configured update feed or Windows-only checks need one manual upgrade
to gain release checks. Installing replaces the upstream app:
same app id, same `t3code://` protocol handler, same state directory, so projects carry over.
WSL support is outside SPY's required scope. No Linux CLI runtime archive is supplied, so the WSL
backend does not start in these builds.

## Linux release builds through WSL2

The same `scripts\release-desktop.cmd` command builds an AppImage in the WSL2 **Debian** distribution. It
refreshes a separate checkout at `~/build/t3code-linux` from the exact local Windows source commit,
installs dependencies using the frozen lockfile, and builds fresh bundles with the same release
version. Linux dependencies and packaging output stay on the Linux filesystem; the completed
AppImage is copied into the Windows release directory. Local changes in the Linux checkout
stop the release instead of being discarded. Concurrent builds using that checkout are rejected.

Set up Debian once with Node/Vite+ matching the repository, a current Rust toolchain, and:

```sh
sudo apt-get update
sudo apt-get install build-essential python3 git curl ca-certificates pkg-config libsecret-1-dev imagemagick libfuse2 clang-19 unzip xz-utils
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

## Desktop distribution

After the maintainer has tested and approved a candidate, the explicit publish command uploads
its `.exe`, `.AppImage`, and `SHA256SUMS.txt` to a draft release
in `spysystem/t3code`, then makes it public once the upload succeeds. Each build uses a fresh
directory below `release/`; it never selects an installer from an earlier build. Release tags
start with `spy-v` so they do not trigger upstream's `v*.*.*` release workflow. Existing releases
are never overwritten. If upload or publication fails, inspect the draft on GitHub and finish
it there, or delete the incomplete draft and any associated tag before retrying the version.

Public notes contain only generic installation guidance and the source commit. Keep internal
configuration values, internal URLs, and colleague onboarding in private documentation; do not
bundle them in installers or include them in release notes. Uploading a release does not enable
automatic updates. There is no current commitment to paid signing services or CI builds.

The release targets are Windows x64 without a WSL backend and Linux x64 AppImage. Fedora and
CachyOS are intended Linux targets; successful packaging does not claim desktop verification on
those distributions. macOS Apple Silicon remains a future target; Intel Mac builds are outside scope.

If CI builds become useful, use a small manually triggered SPY release workflow building
`spy/main` into a draft GitHub Release. To add automatic updates, replace the SPY manual release
mode with the existing desktop updater, configure an explicit
`T3CODE_DESKTOP_UPDATE_REPOSITORY=spysystem/t3code`, and verify the release tag and version scheme
with that updater before enabling it. Setting a feed alone does not change SPY manual mode.
Upstream's release workflow also publishes its npm package and deploys its websites, so it
cannot be enabled unchanged for SPY. Code synchronization with upstream remains a separate
maintainer task; the updater only distributes packaged SPY releases.

Unsigned Windows updates are the first incremental option; they need no signing subscription.
Publish the installer and generated update metadata together with increasing release versions,
and verify an installed-build-to-installed-build update before distribution. Existing installs
with no feed need one manual installation of an update-enabled build. Linux can follow using
AppImage without a paid signing service; verify installation and updates on Fedora and CachyOS.
Desktop releases include their bundled server; standalone `npx t3` servers still use upstream's
npm distribution and need a separate decision before supporting SPY updates.

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

## T3 Connect and dev builds

Connect cannot be tested from `vp run dev:desktop`. Upstream's Clerk instance only allows the
packaged renderer origin `t3code://app`, not the dev one `t3code-dev://app`, and only they can
change that. The browser build hides the Connect switch entirely. Test Connect in an installed
packaged build only.

## Working on the fork

- Dev servers: `vp run dev` for browser work, `vp run dev:desktop` for the Electron shell. Both
  default to the worktree's gitignored `.t3` state, never the installed app's `~/.t3`.
- The installed SPY app is the developer's live instance. Never start a server against
  `~/.t3/userdata` and never kill processes by name; this machine runs several T3 servers.
