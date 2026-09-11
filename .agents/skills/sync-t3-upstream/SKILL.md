---
name: sync-t3-upstream
description: Sync the SPY T3 Code fork from pingdotgg/t3code, preserve unfinished work, verify the rebase, and build a local desktop candidate for testing. Use when asked to sync T3 Code or this fork with upstream (including "sync-t3-code"), or repeat its upstream update workflow.
---

# Sync the T3 Code fork

Repeat the maintainer's upstream update workflow: fetch, update `main`, rebase the fork commits, verify, push, and build a local Windows/Linux test candidate. The maintainer's preference, confirmed on 2026-09-14, is to install and test locally before approving publication. Finish with the installer and candidate directory paths; publish the saved files only after an explicit request following testing. An explicit restriction such as "local only", "no push", or "no build" overrides the corresponding step. If no update is needed, do not create a duplicate candidate merely because the skill was invoked. A follow-up limited to skill edits, documentation wording, or commit metadata does not require another installer.

## Establish the starting point

- Use the current T3 Code checkout. Verify remote identities: `origin` is `spysystem/t3code` and `upstream` is `pingdotgg/t3code`. If invoked elsewhere, locate the intended checkout from session context or ask for its path before changing anything.
- Read `AGENTS.md` and `docs/spy/README.md` for the fork stack and current release procedure. Follow its build-for-testing handoff; publication requires approval of the tested candidate.
- Inspect branch, status including untracked files, remotes, linked worktrees, stashes, and any in-progress Git operation. Default to the current fork branch (normally `spy/main`); resolve an ambiguous target or existing operation before starting another one.
- Fetch both remotes and record the upstream target SHA, original branch tip, merge base, and fork remote tip. Inspect divergence, including remote fork commits absent locally; preserve others' work when choosing the rebase range. If the current branch already contains the fetched upstream tip, avoid unnecessary rewriting.

## Present the incoming changes

- Before stashing, moving branches, or rebasing, present the full list of upstream commits that the sync will add, using the recorded original fork tip and fetched target (`git log --reverse <original-tip>..<upstream-target>`). State both SHAs and the commit count. Include every commit's short SHA and subject, including fixes, maintenance, and mobile-only changes; distinguish mobile source changes from features available in our Windows release.
- Lead with a plain-language overview of the changes, then the complete list. Inspect ambiguous subjects and changes overlapping fork features or unfinished work so the overview identifies likely conflicts and upstream replacements for fork behavior. For a long list, save a complete Markdown report outside the worktree and link it prominently in chat; include every commit rather than substituting selected highlights. If there are no incoming commits, say so explicitly.
- This preview is informational and does not add an approval gate. Continue the authorized sync and candidate build unless the user restricts the task. If the upstream target changes during the run, refresh the list before integrating the new target. Link or repeat the full list in the final handoff so it remains accessible after progress messages collapse.

## Preserve and rebase

### Reassess fork features

- For each fork feature overlapping incoming upstream changes, compare the original user need with upstream's resulting behavior, even when Git reports no conflict. A clean rebase is not proof that the feature still belongs in the fork.
- When upstream satisfies the need, identify the redundant setting, implementation, and tests to remove during the rebase. Preserve any separately needed behavior, such as external linked-folder support, and narrow the owning commit accordingly. An old opt-in toggle need not survive when upstream makes its intended behavior standard.
- Integrate retained settings through upstream's current scope, storage, inheritance, and reset controls. Follow its save/reset semantics across environments and projects; migrate existing values and preserve required older-client compatibility. Verify effective behavior across scopes, including overrides and resets, before publishing.

### Rewrite the stack

- Create a uniquely named backup branch at the original tip, such as `backup/spy-main-before-rebase-YYYYMMDD-HHMMSS`.
- If dirty, record the staged/unstaged split and untracked paths. Stash with `--include-untracked` and a descriptive message; capture this stash's object ID and use that ID thereafter. Keep existing stashes and ignored runtime data untouched. Proceed only when the intended worktree is clean.
- Fast-forward local `main` to the fetched `upstream/main`. For a branch not checked out in any worktree, a ref update is appropriate only after confirming the old tip is an ancestor of the new tip. Preserve unique local-main commits and respect other worktrees; clarify an actual divergence instead of replacing it silently. Preserve branch tracking configuration unless changing it is needed and intended.
- Rebase the fork commits onto the recorded upstream target SHA; use that SHA in rebase and autosquash commands so background fetches cannot change the target. Follow the fork guide's linear commit ownership rules. Resolve conflicts by reading both intents and adapting fork behavior to upstream interfaces. Fold fixes into their owning feature commits and rewrite both title and body to describe the final diff, including any narrowed scope.
- For a `pnpm-lock.yaml` conflict, take the upstream side (`git checkout --ours` during a rebase), run the repository install (`vp i`) to regenerate it with the fork's manifest changes, and stage the result.
- Finish the rebase before restoring the stash. Apply the captured stash, using `--index` when needed to restore staged work. Resolve restoration conflicts while keeping the unfinished work uncommitted. Retain the backup branch and stash for recovery, and report their names.
- In PowerShell, check exit codes before dependent mutations, quote Git expressions containing braces, and use a noninteractive Git editor for rebase continuation. Leave repository hooks enabled.

## Verify and finish

- Review `git range-diff` against the backup to account for every fork commit and any intentional drops already present upstream. Confirm that the recorded upstream tip is an ancestor of the final branch, no conflicts or Git operations remain, and the original branch is checked out.
- Verify restored work against the saved stash: compare additions/deletions and untracked file contents, allowing intentional conflict adaptations. Check the staged/unstaged split. Matching filenames or line counts alone does not prove preservation.
- Refresh dependencies using the repository's package manager if upstream changed manifests or the lockfile. Run focused tests and package typechecks covering conflict resolutions and overlapping behavior, plus scoped lint/format checks. Follow the repository's restriction against repo-wide checks and browser verification without a request. Wait for checks to finish before changing the files they are testing.
- Fix regressions introduced by integration. Distinguish unrelated existing failures from rebase defects, and state any verification limits.
- Check public feature docs and the private colleague guide against the final behavior. Write usage guidance for the current state; remove obsolete controls and redundant explanations of what upstream now provides. Put migration or "what changed" notes in a separate, clearly labeled section only when they help readers update. Check documentation commit messages against their final diffs too.
- Continue through the local candidate build below unless the user restricted the task; publication is a later, separately requested step. Report the upstream SHA, rebased branch, conflict outcomes, checks, restored unfinished work, recovery refs, pushed refs, and local installer/candidate paths or build blocker.

## Push and build for testing

- Push the rebased `spy/main` and fast-forwarded `main` to the verified `origin`. For rewritten history, use `--force-with-lease` with the exact remote SHA inspected before rebasing. If the lease fails, fetch and inspect the new commits; never bypass it with an unconditional force push. Updating remote `main` must be a fast-forward. A different working branch needs an explicit release target; do not redirect it to `spy/main`. PR creation is outside this workflow.
- Use upstream's nightly target version for builds from `main`, with our `-spy.N` suffix. Preview the publisher's choice with `--next-version`; the checked-in package version may still name the previous stable release. Reuse upstream's version resolver as described in the fork guide rather than selecting the base from the latest stable release or an unrelated preview branch.
- Follow `docs/spy/README.md` to check the private colleague guide and run `scripts\release-desktop.cmd` to build the next local Windows/Linux candidate. Build from the verified clean commit. Preserve unrelated restored work in a captured stash before building; restore and verify it afterward. Fix integration regressions before building and report unrelated verification limits.
- Give the maintainer the Windows installer path and the full candidate directory. Stop for installation and testing; do not create or publish a GitHub release. Preserve `candidate.json`, checksums, release notes, and both binaries together.
- After an explicit request to publish the tested candidate, follow the fork guide's `scripts\release-desktop.cmd --publish "<candidate-directory>"` procedure. Publish the saved files without rebuilding. Verify the release source commit and uploaded checksums against the candidate. If publication fails, inspect any draft and tag before retrying without overwriting an existing release.
