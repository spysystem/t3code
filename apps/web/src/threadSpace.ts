import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";

import { devSupportTaskIdFromTitle } from "./components/devSupportTicket.logic";
import { useUiStateStore } from "./uiStateStore";

export const THREAD_SPACE_LABELS: Record<OrchestrationV2ThreadSpace, string> = {
  development: "Development",
  support: "Dev support",
};

export function threadSpaceOf(thread: {
  readonly space?: OrchestrationV2ThreadSpace | undefined;
}): OrchestrationV2ThreadSpace {
  return thread.space ?? "development";
}

/** The dev-support ticket a thread is about; only support threads carry one. */
export function supportTaskIdOf(thread: {
  readonly title: string;
  readonly space?: OrchestrationV2ThreadSpace | undefined;
}): string | null {
  return threadSpaceOf(thread) === "support" ? devSupportTaskIdFromTitle(thread.title) : null;
}

export function otherThreadSpace(space: OrchestrationV2ThreadSpace): OrchestrationV2ThreadSpace {
  return space === "support" ? "development" : "support";
}

/** The space the sidebar shows, and the space new threads are created in. */
export function useSidebarSpace(): OrchestrationV2ThreadSpace {
  return useUiStateStore((state) => state.sidebarSpace);
}

export function readSidebarSpace(): OrchestrationV2ThreadSpace {
  return useUiStateStore.getState().sidebarSpace;
}
