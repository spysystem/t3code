import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";
import { memo, useMemo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useServerConfigs, useThreadShells } from "../../state/entities";
import { otherThreadSpace, THREAD_SPACE_LABELS, useSidebarSpace } from "../../threadSpace";
import { useUiStateStore } from "../../uiStateStore";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { resolveSpaceAttention, type SpaceAttention } from "./spaceAttention.logic";

/** Switches the sidebar between the Development and Dev support thread spaces. */
export const SidebarSpaceSwitch = memo(function SidebarSpaceSwitch() {
  const space = useSidebarSpace();
  const setSidebarSpace = useUiStateStore((state) => state.setSidebarSpace);
  const serverConfigs = useServerConfigs();
  const supported = [...serverConfigs.values()].some(
    (config) => config.environment.capabilities.threadSpaces === true,
  );
  // Keep the switch while the support view is open, so it cannot strand the
  // user there if the capability disappears (e.g. a downgraded server).
  if (!supported && space === "development") return null;
  return (
    <div className="mb-1.5">
      <ToggleGroup
        aria-label="Thread space"
        className="w-full *:flex-1"
        value={[space]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "development" || value === "support") setSidebarSpace(value);
        }}
      >
        <SpaceToggle space="development" current={space} />
        <SpaceToggle space="support" current={space} />
      </ToggleGroup>
    </div>
  );
});

function SpaceToggle({
  space,
  current,
}: {
  readonly space: OrchestrationV2ThreadSpace;
  readonly current: OrchestrationV2ThreadSpace;
}) {
  return (
    <Toggle value={space}>
      {THREAD_SPACE_LABELS[space]}
      {/* The view on screen already shows its own statuses; only the hidden one needs a badge. */}
      {space === otherThreadSpace(current) ? <HiddenSpaceBadge space={space} /> : null}
    </Toggle>
  );
}

function HiddenSpaceBadge({ space }: { readonly space: OrchestrationV2ThreadSpace }) {
  const threads = useThreadShells();
  const localLastVisitedAtByKey = useUiStateStore((state) => state.threadLastVisitedAtById);
  const now = useNowMinute();
  const attention: SpaceAttention = useMemo(
    () => resolveSpaceAttention({ threads, space, localLastVisitedAtByKey, now }),
    [localLastVisitedAtByKey, now, space, threads],
  );
  if (attention.count === 0 || attention.status === null) return null;
  return (
    <span
      aria-label={`${attention.count} waiting in ${THREAD_SPACE_LABELS[space]}`}
      className={cn(
        "ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-3xs font-semibold text-white tabular-nums",
        attention.status.dotClass,
      )}
    >
      {attention.count}
    </span>
  );
}
