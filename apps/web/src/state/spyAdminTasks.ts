import type {
  EnvironmentId,
  IssueTrackerConnection,
  IssueTrackerConnectionList,
  ProjectId,
} from "@t3tools/contracts";
import { SPY_ADMIN_TRACKER } from "@t3tools/shared/spyAdminTasks";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { issueEnvironment } from "./issues";
import { issueTrackerEnvironment } from "./issueTrackers";

/** SPY Admin as an environment has it connected, or null while it has no working token. */
export function connectedSpyAdminTracker(
  connections: IssueTrackerConnectionList | null,
): (IssueTrackerConnection & { readonly environmentScope: string }) | null {
  for (const tracker of connections?.trackers ?? []) {
    const { environmentScope } = tracker;
    if (
      tracker.tracker === SPY_ADMIN_TRACKER &&
      tracker.account !== null &&
      environmentScope !== undefined
    )
      return { ...tracker, environmentScope };
  }
  return null;
}

/**
 * A task as a thread link, read once for a caller that links it outside a mounted view. Null
 * when the environment has no connected Admin or Admin does not answer with the task.
 */
export function readSpyAdminTaskLink(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  taskId: string,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const tracker = connectedSpyAdminTracker(
        yield* AtomRegistry.getResult(
          appAtomRegistry,
          issueTrackerEnvironment.connections({ environmentId, input: {} }),
          { suspendOnWaiting: true },
        ),
      );
      if (tracker === null) return null;
      const target = {
        tracker: tracker.tracker,
        host: tracker.host,
        scope: tracker.environmentScope,
        key: taskId,
      };
      const task = yield* AtomRegistry.getResult(
        appAtomRegistry,
        issueEnvironment.detail({ environmentId, input: { projectId, ...target } }),
        { suspendOnWaiting: true },
      );
      return {
        ...target,
        projectId,
        url: task.url,
        displayKey: task.displayKey,
        title: task.title,
        source: "manual" as const,
      };
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}
