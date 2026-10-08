import type { OrchestrationV2ThreadSpace } from "@t3tools/contracts";

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
