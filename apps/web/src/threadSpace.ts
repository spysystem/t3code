import { OrchestrationV2ThreadSpace } from "@t3tools/contracts";

import { useUiStateStore } from "./uiStateStore";

export const THREAD_SPACE_LABELS: Record<OrchestrationV2ThreadSpace, string> = {
  development: "Development",
  support: "Dev support",
  automation: "Automation",
};

/** Every space, in the order the sidebar switch shows them. */
export const THREAD_SPACES = OrchestrationV2ThreadSpace.literals;

export function threadSpaceOf(thread: {
  readonly space?: OrchestrationV2ThreadSpace | undefined;
}): OrchestrationV2ThreadSpace {
  return thread.space ?? "development";
}

interface ThreadSpaceCapabilities {
  readonly threadSpaces?: boolean | undefined;
  readonly threadSpaceIds?: ReadonlyArray<string> | undefined;
}

/**
 * The spaces a server stores. SPY servers from before Automation report only
 * `threadSpaces` and reject any other space, so they get the first two.
 */
export function environmentThreadSpaces(
  capabilities: ThreadSpaceCapabilities | undefined,
): ReadonlyArray<OrchestrationV2ThreadSpace> {
  if (capabilities?.threadSpaces !== true) return [];
  const ids = capabilities.threadSpaceIds;
  return ids === undefined
    ? ["development", "support"]
    : THREAD_SPACES.filter((space) => ids.includes(space));
}

/**
 * The spaces the sidebar switch offers: those a connected server stores, plus the one on
 * screen and Development, so a space with no server behind it never strands the user.
 * Empty when there is nothing to switch between.
 */
export function switchableThreadSpaces(
  configs: Iterable<{ readonly environment: { readonly capabilities: ThreadSpaceCapabilities } }>,
  current: OrchestrationV2ThreadSpace,
): ReadonlyArray<OrchestrationV2ThreadSpace> {
  const available = new Set<OrchestrationV2ThreadSpace>([current, "development"]);
  for (const config of configs) {
    for (const space of environmentThreadSpaces(config.environment.capabilities)) {
      available.add(space);
    }
  }
  return available.size > 1 ? THREAD_SPACES.filter((space) => available.has(space)) : [];
}

/** The space the sidebar shows, and the space new threads are created in. */
export function useSidebarSpace(): OrchestrationV2ThreadSpace {
  return useUiStateStore((state) => state.sidebarSpace);
}

export function readSidebarSpace(): OrchestrationV2ThreadSpace {
  return useUiStateStore.getState().sidebarSpace;
}
