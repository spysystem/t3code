import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { isMacPlatform } from "../lib/utils";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { openDesktopUpdateReleaseNotes } from "./desktopUpdate.toast";
import { stackedThreadToast, toastManager } from "./ui/toast";

export function SpyUpdateNotification() {
  const state = useDesktopUpdateState();
  const [dismissedVersion, setDismissedVersion] = useLocalStorage(
    "t3code:spy-update-dismissed-version",
    "",
    Schema.String,
  );
  const version = state?.manual ? state.availableVersion : null;
  const releaseUrl = state?.releaseUrl;

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !version || !releaseUrl || version === dismissedVersion) return;

    const id = toastManager.add(
      stackedThreadToast({
        type: "info",
        title: `SPY update available: ${version}`,
        // Mirrors spyUpdateInstructions in apps/desktop/src/updates/spyRelease.ts.
        description: isMacPlatform(navigator.platform)
          ? "Quit T3 Code, then rerun the SPY Mac build script with --install."
          : "Download the installer from GitHub, then close T3 Code and run it.",
        timeout: 0,
        actionProps: {
          children: "View release on GitHub",
          onClick: () => {
            void openDesktopUpdateReleaseNotes(bridge, releaseUrl);
          },
        },
        data: {
          hideCopyButton: true,
          onClose: () => setDismissedVersion(version),
        },
      }),
    );
    return () => toastManager.close(id);
  }, [dismissedVersion, releaseUrl, setDismissedVersion, version]);

  return null;
}
