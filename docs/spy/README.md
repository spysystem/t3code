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
- **Desktop releases are unsigned local Windows builds**, published to public GitHub Releases
  by the local build script. Installation remains manual and the updater stays off. Signing
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
installation/update workflow, update `developer/internal/t3-code.md` in the private
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

To build and publish a public Windows x64 release in one step, run:

```powershell
.t3\build-desktop-win.cmd --publish
```

The script uses upstream's `scripts/resolve-nightly-release.ts` resolver to choose the release
base for builds from `main`, then chooses the next `-spy.N` suffix from GitHub releases
(including drafts) and remote tags. Upstream currently advances the patch version from
`apps/desktop/package.json`: package version `0.0.40` targets `0.0.41`, so our first build is
`0.0.41-spy.1`. Further builds increment the SPY suffix; when the nightly target becomes
`0.0.42`, numbering starts at `0.0.42-spy.1`. Upstream's package version can lag its nightly
release name, so it is not used directly as our release base. The script prints the selected
version before building. To see the next version without
building or publishing, run `.t3\build-desktop-win.cmd --next-version`; this also works with
uncommitted changes. A preview does not reserve a version. An explicit override remains available:
`.t3\build-desktop-win.cmd --publish 0.0.41-spy.7`.

Authenticate GitHub CLI with `gh auth login` first, using an account with write access
to `spysystem/t3code`. Commit the intended source and push it to `spy/main` before publishing;
the script requires a clean checkout at that remote commit. Publishing always rebuilds the JS
artifacts, regardless of an ambient skip-build setting.

The local CMD wrapper dispatches `--publish` to
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1`, adding
`-Version VERSION` only when supplied. It dispatches `--next-version` to the same script with
`-NextVersion`.
The publisher then calls the wrapper without arguments to perform the build. When recreating
the wrapper, preserve this dispatch and propagate the build exit code with `call vp run
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

The artifact is unsigned, so SmartScreen warns on first run. The updater reports "no update feed
is configured" because no `T3CODE_DESKTOP_UPDATE_REPOSITORY` was set at build time; that is
what keeps upstream releases from overwriting a SPY install. Installing replaces the upstream app:
same app id, same `t3code://` protocol handler, same state directory, so projects carry over.
WSL support is outside SPY's required scope. No Linux node-pty prebuild is supplied, so the WSL
backend does not start in these builds.

## Desktop distribution

The local publisher uploads the `.exe` directly, alongside `SHA256SUMS.txt`, to a draft release
in `spysystem/t3code`, then makes it public once the upload succeeds. Each build uses a fresh
directory below `release/`; it never selects an installer from an earlier build. Release tags
start with `spy-v` so they do not trigger upstream's `v*.*.*` release workflow. Existing releases
are never overwritten. If upload or publication fails, inspect the draft on GitHub and finish
it there, or delete the incomplete draft and any associated tag before retrying the version.

Public notes contain only generic installation guidance and the source commit. Keep internal
configuration values, internal URLs, and colleague onboarding in private documentation; do not
bundle them in installers or include them in release notes. Uploading a release does not enable
automatic updates. There is no current commitment to paid signing services or CI builds.

The intended future desktop scope is Windows x64 without WSL, macOS Apple Silicon only (no
Intel builds), and Linux x64 supporting at least Fedora and CachyOS. These are future support
targets, not claims that SPY builds have been verified on those systems.

If CI builds become useful, use a small manually triggered SPY release workflow building
`spy/main` into a draft GitHub Release. To add automatic updates, use the existing desktop updater
with an explicit `T3CODE_DESKTOP_UPDATE_REPOSITORY=spysystem/t3code` and verify the release tag and
version scheme with that updater before enabling it.
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
