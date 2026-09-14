# Updating T3 Code

T3 Code clients and servers can run on different machines and must share a compatible orchestration protocol. When a server or provider is behind, the sidebar update button and **Settings → Environments** handle updates.

## Update everything at once

Click the **Update** button at the bottom of the sidebar (web or desktop) to update outdated providers, behind servers, and the desktop app in one step.

- Hover to preview what will update; click while running to view per-machine progress or retry failures.
- Confirmation dialogs show which machines are skipped (offline or manual-only) and how many active threads will pause/resume.
- Choose **Later** on the desktop restart countdown to restart when ready.

## Switch between Stable and Nightly

In the desktop app, change **Settings → About → Update track** to switch connected machines together.

- Moving a background service to an older Stable release requires running `t3 update --channel stable --allow-downgrade` on that host.
- A switch is blocked if the machine's database has schema changes the target track doesn't support yet. macOS desktop apps must switch on that Mac.

## Continue threads after restarts

**Settings → Maintenance → Continue threads after restarts** is enabled by default. After an update, crash, or reboot (once T3 Code starts again), supported active threads automatically resume—and threads waiting on subagents or monitors are woken and notified that background work stopped.

- Threads waiting for your approval/answer/secret—or archived, snoozed, or settled—are not auto-resumed.
- After 3 consecutive crash recoveries of an unfinished turn, the thread waits for your next message.
- Updating from V1? Read [Threads from older T3 Code versions](./thread-migration.md).

## SPY desktop releases

The SPY Windows and Linux x64 and Apple Silicon Mac apps check for newer fork releases on
startup and every four hours. Use **Check for updates** in the app menu or **Settings → About** to check
manually. On Windows, download an available update from the sidebar update button or
**Settings → About**, then choose to restart and install it. On Linux and Macs, **View release on GitHub**
opens the release page of an available update. There, updating everything at once updates
connected machines and providers but not the app you are using.
On Fedora and Linux Mint, install T3 Code from the
[SPY package repository](https://spysystem.github.io/t3code-packages/); the update notice then
shows the command that updates it (`sudo dnf upgrade --refresh t3code`, or
`sudo apt update && sudo apt install --only-upgrade t3code`), after which you restart T3 Code.
If you used the AppImage before, remove it. On other Linux distributions, download the
`.AppImage`, mark it executable, close T3 Code, and run the new file.
On a Mac, quit T3 Code and rerun the build command from the release notes; it builds and
installs the new release.
The app does not download or install updates until you choose to.

SPY releases follow upstream's Stable releases. On Windows, **Settings → About → Update track**
can switch this app to Nightly, which follows upstream's nightly builds instead. A switch moves
only this app, and only to a newer build: changing to Stable waits for the next Stable release
newer than your Nightly, usually a few days. Connected machines keep their own versions.

Dismissing an update notification hides it until a different version is available;
the release remains accessible through Settings and the sidebar update button.
Older SPY installations that report no configured update feed or Windows-only checks need one manual
upgrade from [SPY releases](https://github.com/spysystem/t3code/releases) to gain
these checks. Likewise, a Windows installation that only offers **View release on GitHub**
needs one manual installation of a newer release to gain in-app updates. Update checks
refer to the desktop app on the machine you are using.

## Update a connected server manually

| Situation                           | Action                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Background service / desktop server | Click **Update server** in **Settings → Environments** (desktop hosts relaunch automatically).        |
| Installed `t3` CLI                  | Run `t3 update <version>` on the host (then `t3 service restart` if you declined the restart prompt). |
| `npx` server                        | Stop the server and relaunch with `npx t3@<version>` and your usual flags.                            |
| Package manager (Nix, AUR)          | Update via your package manager.                                                                      |

Each server checks npm/Homebrew/pnpm using its own local registry and proxy settings.

## Update providers

Open **Settings → Providers** and click **Update now** on individual providers or **Update all** across connected environments. Running chats keep using their current CLI until they end; new sessions and model catalogs refresh automatically. (Provider update checks in **Settings → Maintenance** must be enabled to fetch model catalog updates.)

## Mobile updates

- Update connected environments and providers from **Settings → Environments** on mobile.
- Update the mobile app via the App Store or Google Play (background over-the-air updates apply on next app switch and preserve drafts/queued messages).

## Troubleshooting

- **Version mismatch**: Update whichever side (app or server) the connection notice names.
- **Failed update**: Retry once; confirm you updated the host machine (not just the client) and that only one server owns the T3 home directory.
- **macOS Alpha → Beta**: Open `/Applications/T3 Code (Beta).app` manually and re-pin it to the Dock.
- **Desktop won't start**: Use the recovery window's **Update** button, install the linked last-working version, or **Copy details** for a bug report.
