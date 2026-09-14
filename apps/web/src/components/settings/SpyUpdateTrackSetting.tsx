import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { channelSwitchLabel } from "../sidebar/updateEverything.logic";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

/** SPY Windows builds only move this app, and never to an older build, so no database check runs. */
export function SpyUpdateTrackSetting({
  channel,
  disabled,
}: {
  readonly channel: DesktopUpdateChannel;
  readonly disabled: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const setting = useSearchableSetting();
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
          title: gt("Could not switch to {track}", { track: channelSwitchLabel(next, messages) }),
          description:
            error instanceof Error ? error.message : gt("The update track did not change."),
        }),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsRow
      {...setting("update-track")}
      description={gt(
        "Nightly follows upstream's nightly builds. A switch installs the next newer build on that track, so moving to Stable waits for its next release.",
      )}
      control={
        <Select
          value={channel}
          onValueChange={(value) => void change(value as DesktopUpdateChannel)}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label={gt("Update track")}
            disabled={disabled || pending}
          >
            <SelectValue>{channelSwitchLabel(channel, messages)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="latest">
              {channelSwitchLabel("latest", messages)}
            </SelectItem>
            <SelectItem hideIndicator value="nightly">
              {channelSwitchLabel("nightly", messages)}
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}
