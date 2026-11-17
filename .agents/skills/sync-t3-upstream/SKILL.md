---
name: sync-t3-upstream
description: Sync the SPY T3 Code fork from pingdotgg/t3code on its Stable and Nightly channels, preserve unfinished work, verify the rebase, and build local desktop candidates for testing. Use when asked to sync T3 Code or this fork with upstream (including "sync-t3-code"), or repeat its upstream update workflow.
---

# Sync the T3 Code fork

Repeat the maintainer's upstream update workflow: fetch, update `main`, rebase the fork commits per channel, verify, push, and build local test candidates. The maintainer's preference, confirmed on 2026-09-14, is to install and test locally before approving publication. Finish with the installer and candidate directory paths; publish the saved files only after an explicit request following testing. An explicit restriction such as "local only", "no push", "no build", "only stable", or "only nightly" overrides the corresponding step. If no update is needed, do not create a duplicate candidate merely because the skill was invoked. A follow-up limited to skill edits, documentation wording, or commit metadata does not require another installer.

## Channels

The fork ships two **channels** carrying the same commit stack (`docs/spy/README.md`, `docs/spy/releasing.md`):

| Channel | Branch       | Rebase target                                                                    | Candidate               |
| ------- | ------------ | -------------------------------------------------------------------------------- | ----------------------- |
| Nightly | `spy/main`   | `git describe --tags --abbrev=0 --match 'v*-nightly.*' upstream/main`            | Windows x64             |
| Stable  | `spy/stable` | `git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' upstream/main` | Windows x64 + Linux x64 |

A channel is **due** when its target differs from the upstream tag its branch sits on. Nightly is the working channel: fork features live on `spy/main`, and `spy/stable` is rebuilt from it. Stable is also due when `spy/main`'s fork commits differ from `origin/spy/stable-source`, the `spy/main` commit of the last Stable rebuild: `git range-diff $(git merge-base origin/spy/stable-source upstream/main)..origin/spy/stable-source $(git merge-base spy/main upstream/main)..spy/main` shows anything but `=`. Folded fixes count. Stable is also due when `spy/stable` or `spy/stable-source` does not exist yet. Sync every due channel, Nightly first. A feature held back from Stable because it needs newer upstream code is the only accepted gap; name it in the report. Publishing a Nightly candidate refuses while Stable lags (`--allow-stable-lag` overrides for a held-back feature).

## Establish the starting point

- Use the current T3 Code checkout. Verify remote identities: `origin` is `spysystem/t3code` and `upstream` is `pingdotgg/t3code`. If invoked elsewhere, locate the intended checkout from session context or ask for its path before changing anything.
- Read `AGENTS.md` and `docs/spy/README.md` for the fork stack, and `docs/spy/releasing.md` for the current release procedure. Follow its build-for-testing handoff; publication requires approval of the tested candidate.
- Inspect branch, status including untracked files, remotes, linked worktrees, stashes, and any in-progress Git operation. Resolve an ambiguous target or existing operation before starting another one.
- Fetch both remotes with tags (`git fetch upstream --tags`, `git fetch origin`). For each channel, record its target tag and SHA, its branch's original tip, current upstream base (`git merge-base <branch> upstream/main`), and remote tip. Inspect divergence, including remote fork commits absent locally; preserve others' work when choosing the rebase range. Decide which channels are due.

## Present the incoming changes

- Before stashing, moving branches, or rebasing, present the full list of upstream commits each due channel will add, using its branch's recorded original tip and target (`git log --reverse <original-tip>..<target>`). Present each due channel's list separately; for Stable, mark the commits that Nightly already ships. State the SHAs and commit counts. Include every commit's short SHA and subject, including fixes, maintenance, and mobile-only changes; distinguish mobile source changes from features available in our Windows release.
- Lead with a plain-language overview of the changes, then the complete list. Inspect ambiguous subjects and changes overlapping fork features or unfinished work so the overview identifies likely conflicts and upstream replacements for fork behavior. For a long list, save a complete Markdown report outside the worktree and link it prominently in chat; include every commit rather than substituting selected highlights. If there are no incoming commits, say so explicitly.
- This preview is informational and does not add an approval gate. Continue the authorized sync and candidate build unless the user restricts the task. If the upstream target changes during the run, refresh the list before integrating the new target. Link or repeat the full list in the final handoff so it remains accessible after progress messages collapse.

## Preserve and rebase

### Reassess fork features

- For each fork feature overlapping incoming upstream changes, compare the original user need with upstream's resulting behavior, even when Git reports no conflict. A clean rebase is not proof that the feature still belongs in the fork.
- When upstream satisfies the need, identify the redundant setting, implementation, and tests to remove during the rebase. Preserve any separately needed behavior, such as external linked-folder support, and narrow the owning commit accordingly. An old opt-in toggle need not survive when upstream makes its intended behavior standard.
- Integrate retained settings through upstream's current scope, storage, inheritance, and reset controls. Follow its save/reset semantics across environments and projects; migrate existing values and preserve required older-client compatibility. Verify effective behavior across scopes, including overrides and resets, before publishing.

### Rewrite the stack

- Create a uniquely named backup branch at each existing branch's original tip, such as `backup/spy-main-before-rebase-YYYYMMDD-HHMMSS` and `backup/spy-stable-…`.
- If dirty, record the staged/unstaged split and untracked paths. Stash with `--include-untracked` and a descriptive message; capture this stash's object ID and use that ID thereafter. Keep existing stashes and ignored runtime data untouched. Proceed only when the intended worktree is clean.
- Fast-forward local `main` to the fetched `upstream/main`. For a branch not checked out in any worktree, a ref update is appropriate only after confirming the old tip is an ancestor of the new tip. Preserve unique local-main commits and respect other worktrees; clarify an actual divergence instead of replacing it silently. Preserve branch tracking configuration unless changing it is needed and intended.
- Nightly: rebase `spy/main`'s fork commits onto the recorded nightly target SHA; use that SHA in rebase and autosquash commands so background fetches cannot change the target. Follow the fork guide's linear commit ownership rules. Resolve conflicts by reading both intents and adapting fork behavior to upstream interfaces. Fold fixes into their owning feature commits and rewrite both title and body to describe the final diff, including any narrowed scope.
- Stable, after Nightly is verified: rebuild `spy/stable` from the final `spy/main` with `git branch -f spy/stable spy/main`, then `git rebase --onto <stable-target-sha> <nightly-target-sha> spy/stable`. Resolve conflicts against the older base on `spy/stable` only; `spy/main` keeps its form. A feature that needs upstream code newer than the stable tag is left out of `spy/stable` (`git rebase --skip`), named in the report, and returns with the next stable release. Enable `rerere` (`git -c rerere.enabled=true rebase …`) so repeated resolutions carry to the next stable rebuild.
- For a `pnpm-lock.yaml` conflict, take the upstream side (`git checkout --ours` during a rebase), run the repository install (`vp i`) to regenerate it with the fork's manifest changes, and stage the result.
- Finish the rebase before restoring the stash. Apply the captured stash, using `--index` when needed to restore staged work. Resolve restoration conflicts while keeping the unfinished work uncommitted. Retain the backup branch and stash for recovery, and report their names.
- In PowerShell, check exit codes before dependent mutations, quote Git expressions containing braces, and use a noninteractive Git editor for rebase continuation. Leave repository hooks enabled.

## Verify and finish

- Review `git range-diff` against each backup to account for every fork commit and any intentional drops already present upstream. Compare the two stacks (`git range-diff <nightly-target>..spy/main <stable-target>..spy/stable`): every feature appears in both, or its absence from Stable is reported. Confirm each target is an ancestor of its branch, no conflicts or Git operations remain, and the original branch is checked out.
- Verify restored work against the saved stash: compare additions/deletions and untracked file contents, allowing intentional conflict adaptations. Check the staged/unstaged split. Matching filenames or line counts alone does not prove preservation.
- Refresh dependencies using the repository's package manager if upstream changed manifests or the lockfile. Run focused tests and package typechecks covering conflict resolutions and overlapping behavior on each rebased branch, plus scoped lint/format checks (`vp lint --quiet <files>` reports errors without pre-existing warnings). Follow the repository's restriction against repo-wide checks and browser verification without a request. Wait for checks to finish before changing the files they are testing.
- Fix regressions introduced by integration. Distinguish unrelated existing failures from rebase defects, and state any verification limits.
- Check public feature docs against the final behavior.
- Check the private colleague guide as published: fetch `C:/Spy/Code/spy-documentation` and read `developer/internal/t3-code/t3-code.md` at `origin/main`. A dirty or behind local clone is a draft; compare it against `origin/main` before describing or committing it. The check is done when every row of **What the fork adds** maps to a commit in `upstream/main..spy/main` and every user-facing feature commit has a row; a dropped fork feature loses its row in the same task.
- For both: write usage guidance for the current state; remove obsolete controls and redundant explanations of what upstream now provides. Put migration or "what changed" notes in a separate, clearly labeled section only when they help readers update. Check documentation commit messages against their final diffs too.
- Continue through the local candidate build below unless the user restricted the task; publication is a later, separately requested step. Report each channel's upstream tag and SHA, rebased branch, conflict outcomes, features held back from Stable, checks, restored unfinished work, recovery refs, pushed refs, and local installer/candidate paths or build blocker.

## Push and build for testing

- Push the rebased `spy/main`, `spy/stable`, and fast-forwarded `main` to the verified `origin`, and with `spy/stable` push the `spy/main` commit it was rebuilt from as `spy/stable-source` (`<sha>:refs/heads/spy/stable-source`). For rewritten history, use `--force-with-lease=<branch>:<inspected-remote-sha>`; a first `spy/stable` push expects no remote branch (`--force-with-lease=spy/stable:`). If the lease fails, fetch and inspect the new commits; never bypass it with an unconditional force push. Updating remote `main` must be a fast-forward. A different working branch needs an explicit release target; do not redirect it to a channel branch. PR creation is outside this workflow.
- Build one candidate per synced channel with `scripts\release-desktop.cmd` as described in `docs/spy/releasing.md`, from a clean checkout of the channel's branch: `spy/stable` builds Stable, `spy/main` Nightly. The script names the version after the upstream tag the branch sits on; preview it with `--next-version` and expect `X.Y.Z-spy.N` for Stable and `X.Y.Z-nightly.D.R.spy.N` for Nightly. Builds share a lock, so run them one after the other.
- The build takes several minutes. Run it in the background with output redirected to a log outside the worktree, followed by an `EXIT=$LASTEXITCODE` line; its completion notification is the signal, so skip a Monitor. Afterwards read the log's `Test installer:`, `Candidate directory:`, and `EXIT=` lines; on failure, read the PowerShell error above `EXIT=`. electron-builder's `Command "pwd" not found` line is an expected Windows probe. Preserve unrelated restored work in a captured stash before building; restore and verify it afterward. Fix integration regressions before building and report unrelated verification limits.
- Give the maintainer each channel's Windows installer path and full candidate directory. Stop for installation and testing; do not create or publish a GitHub release. Preserve each candidate directory intact.
- After an explicit request to publish a tested candidate, follow the fork guide's `scripts\release-desktop.cmd --publish "<candidate-directory>"` procedure. Publish the saved files without rebuilding. Verify the release source commit and uploaded checksums against the candidate: `gh release view <tag> -R spysystem/t3code --json isDraft,targetCommitish,assets` (asset `digest` is the SHA-256), `gh api repos/spysystem/t3code/git/ref/tags/<tag>`, and the downloaded `SHA256SUMS.txt` compared with the candidate's copy. If publication fails, inspect any draft and tag before retrying without overwriting an existing release.
