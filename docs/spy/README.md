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
  exact tested files requires a separate maintainer request. Apple Silicon Mac users build each
  published release themselves. Packaged SPY builds check for SPY releases and link to
  GitHub for manual updates; automatic installation stays off. Signing
  subscriptions and CI builds are deferred. See [releasing.md](releasing.md).

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
docs use generic examples; this README and [releasing.md](releasing.md) own fork maintenance
and release procedures. In the
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

## Desktop releases

Building, testing, or publishing a desktop release, or changing its scripts: read
[releasing.md](releasing.md).

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
