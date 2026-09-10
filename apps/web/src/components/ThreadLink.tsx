import { useAtomValue } from "@effect/atom-react";
import { getThreadLink, resolveThreadLinkRules } from "@t3tools/client-runtime/thread-links";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { TicketIcon } from "lucide-react";
import { serverEnvironment } from "../state/server";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ThreadLink({
  thread,
}: {
  thread: { title: string; environmentId: EnvironmentId; projectId: ProjectId };
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(thread.environmentId));
  const task = getThreadLink(thread.title, resolveThreadLinkRules(settings, thread.projectId));
  if (task === null) return null;

  const label = task.label;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            draggable={false}
            className="inline-flex max-w-40 shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap border-b border-transparent text-xs text-muted-foreground tabular-nums hover:border-current hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onAuxClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") event.stopPropagation();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          />
        }
      >
        <TicketIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{task.text}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
