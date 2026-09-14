import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { useState } from "react";

import { channelSwitchLabel } from "../sidebar/updateEverything.logic";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** SPY Windows builds only move this app, and never to an older build, so no database check runs. */
export function SpyUpdateTrackSetting({
  channel,
  disabled,
}: {
  readonly channel: DesktopUpdateChannel;
  readonly disabled: boolean;
}) {
  const [pending, setPending] = useState(false);

  const change = async (next: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;
    if (!bridge || next === channel) return;
    setPending(true);
    try {
      await bridge.setUpdateChannel(next);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not switch to ${channelSwitchLabel(next)}`,
          description: error instanceof Error ? error.message : "The update track did not change.",
        }),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("update-track")}
      description="Nightly follows upstream's nightly builds. A switch installs the next newer build on that track, so moving to Stable waits for its next release."
      control={
        <Select
          value={channel}
          onValueChange={(value) => void change(value as DesktopUpdateChannel)}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label="Update track"
            disabled={disabled || pending}
          >
            <SelectValue>{channelSwitchLabel(channel)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="latest">
              Stable
            </SelectItem>
            <SelectItem hideIndicator value="nightly">
              Nightly
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}
