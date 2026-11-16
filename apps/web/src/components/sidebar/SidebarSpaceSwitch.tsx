import { isOrchestrationV2ThreadSpace, type OrchestrationV2ThreadSpace } from "@t3tools/contracts";
import { BotIcon, CodeIcon, type LucideIcon, TicketIcon } from "lucide-react";
import { memo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useDelegatedUnderParent, useServerConfigs, useThreadShells } from "../../state/entities";
import { switchableThreadSpaces, THREAD_SPACE_LABELS, useSidebarSpace } from "../../threadSpace";
import { useUiStateStore } from "../../uiStateStore";
import { openDevSupportTicketDialog } from "../DevSupportTicketDialog";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveSpaceAttention, type SpaceAttention } from "./spaceAttention.logic";

const SPACE_ICONS: Record<OrchestrationV2ThreadSpace, LucideIcon> = {
  development: CodeIcon,
  support: TicketIcon,
  automation: BotIcon,
};

/** Switches the sidebar between thread spaces. */
export const SidebarSpaceSwitch = memo(function SidebarSpaceSwitch() {
  const space = useSidebarSpace();
  const setSidebarSpace = useUiStateStore((state) => state.setSidebarSpace);
  const shown = switchableThreadSpaces(useServerConfigs().values(), space);
  if (shown.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-col gap-1.5">
      <ToggleGroup
        aria-label="Thread space"
        className="w-full *:data-pressed:flex-1"
        value={[space]}
        onValueChange={(next) => {
          const value = next[0];
          if (isOrchestrationV2ThreadSpace(value)) setSidebarSpace(value);
        }}
      >
        {shown.map((candidate) => (
          <SpaceToggle key={candidate} space={candidate} current={space} />
        ))}
      </ToggleGroup>
      {space === "support" ? (
        <Button variant="outline" size="sm" onClick={openDevSupportTicketDialog}>
          <TicketIcon />
          Start from ticket
        </Button>
      ) : null}
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
  const Icon = SPACE_ICONS[space];
  const label = THREAD_SPACE_LABELS[space];
  if (space === current) {
    return (
      <Toggle value={space}>
        <Icon />
        {label}
      </Toggle>
    );
  }
  // Three names do not fit the sidebar, so hidden spaces show their icon and badge.
  return (
    <Tooltip>
      <TooltipTrigger render={<Toggle value={space} />}>
        <Icon />
        <span className="sr-only">{label}</span>
        <HiddenSpaceBadge space={space} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function HiddenSpaceBadge({ space }: { readonly space: OrchestrationV2ThreadSpace }) {
  const threads = useThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAtByKey = useUiStateStore((state) => state.threadLastVisitedAtById);
  const now = useNowMinute();
  const attention: SpaceAttention = resolveSpaceAttention({
    threads,
    delegatedUnderParent,
    space,
    localLastVisitedAtByKey,
    now,
  });
  if (attention.count === 0 || attention.status === null) return null;
  return (
    <span
      aria-label={`${attention.count} waiting in ${THREAD_SPACE_LABELS[space]}`}
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-3xs font-semibold text-white tabular-nums",
        attention.status.dotClass,
      )}
    >
      {attention.count}
    </span>
  );
}
