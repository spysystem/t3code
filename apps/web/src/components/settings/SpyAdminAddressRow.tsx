import type { EnvironmentId } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { useGT } from "gt-react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { DraftInput } from "../ui/draft-input";
import { SettingsRow } from "./settingsLayout";

const selectAddress = (settings: UnifiedSettings) => settings.spyAdminUrl;

/** Where an environment's SPY Admin is served. The server reads it at start, so a change waits for a restart. */
export function SpyAdminAddressRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const address = useEnvironmentSettings(environmentId, selectAddress);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const label = gt("SPY Admin address");
  return (
    <SettingsRow
      title={label}
      description={gt(
        "Where SPY Admin is served, such as admin.example.com. Restart T3 Code after changing it; SPY Admin then appears below to connect.",
      )}
      control={
        <div className="flex w-full min-w-0 items-center @min-[32rem]/settings-row:w-56">
          <DraftInput
            size="sm"
            className="min-w-0 flex-1"
            value={address}
            onCommit={(next) => updateSettings({ spyAdminUrl: next.trim() })}
            placeholder="admin.example.com"
            spellCheck={false}
            aria-label={label}
          />
        </div>
      }
    />
  );
}
