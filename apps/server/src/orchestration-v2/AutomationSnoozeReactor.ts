import {
  CommandId,
  orchestrationV2ThreadSpaceOf,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { isSnoozed, threadHasQueuedTurnStart } from "./ThreadSettlementService.ts";

/**
 * Renewed at each quiet turn end that finds the thread awake. A thread that stays
 * snoozed keeps its deadline, so a busy bot thread surfaces about once a year; one
 * that has been silent this long wakes once and can then auto-settle.
 */
const AUTOMATION_SNOOZE = Duration.days(365);

/**
 * Longer than the client's visit throttle (10 s): an open thread records a visit for
 * its finished turn before the decision, so a thread on screen is never snoozed.
 */
const VISIT_GRACE = Duration.seconds(15);

const atOrAfter = (value: DateTime.Utc | null | undefined, sinceMs: number) =>
  value != null && DateTime.toEpochMillis(value) >= sinceMs;

/**
 * The turn's start, when its finished turn should snooze the Automation thread; null
 * otherwise. Bots run these threads, so the snooze keeps them out of every client's
 * thread list, including mobile apps that do not know spaces. Approvals, new
 * questions and failures wake it through the usual snooze rules.
 */
function automationSnoozeTurnBegan(input: {
  readonly shell: OrchestrationV2ThreadShell;
  readonly thread: Pick<OrchestrationV2AppThread, "lastSnoozeWakeAt">;
  readonly completedRunId: string;
  readonly nowMs: number;
}): DateTime.Utc | null {
  const { shell, thread, nowMs } = input;
  if (orchestrationV2ThreadSpaceOf(shell) !== "automation") return null;
  if (shell.latestRunId !== input.completedRunId || shell.status !== "completed") return null;
  if (shell.latestRunStopRequested === true || shell.activityRunStatus != null) return null;
  if (shell.archivedAt !== null || shell.deletedAt !== null) return null;
  if (shell.settledOverride === "settled" || shell.pinnedAt != null) return null;
  // Waits on the user: an approval, a question, a guest, or a plan to accept.
  if (shell.pendingRuntimeRequest !== null || (shell.pendingGuestMessageCount ?? 0) > 0) {
    return null;
  }
  if (shell.interactionMode === "plan" && shell.hasActionableProposedPlan) return null;
  if (threadHasQueuedTurnStart(shell, nowMs)) return null;
  // Keeps a snooze someone chose, and the snoozedAt that question wakes compare against.
  if (isSnoozed(shell, nowMs)) return null;
  const turnBegan = shell.latestRunRequestedAt ?? shell.latestRunStartedAt;
  if (turnBegan == null) return null;
  // Anyone who opened, woke or wrote to the thread since the turn began is using it.
  const turnBeganMs = DateTime.toEpochMillis(turnBegan);
  const touched = [
    shell.lastVisitedAt,
    thread.lastSnoozeWakeAt,
    shell.latestUserAuthoredMessageAt,
  ].some((interactedAt) => atOrAfter(interactedAt, turnBeganMs));
  return touched ? null : turnBegan;
}

const isCompletedRun = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" && event.payload.status === "completed";

export class AutomationSnoozeReactor extends Context.Service<
  AutomationSnoozeReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Waits out the visit grace, then snoozes the thread if its finished turn was quiet. */
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/AutomationSnoozeReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const handle: AutomationSnoozeReactor["Service"]["handle"] = Effect.fn(
    "AutomationSnoozeReactor.handle",
  )(
    function* (event) {
      if (event.type !== "run.updated" || event.payload.status !== "completed") return;
      const before = yield* projections.getThreadShell(event.threadId);
      if (before === null || orchestrationV2ThreadSpaceOf(before) !== "automation") return;
      yield* Effect.sleep(VISIT_GRACE);
      const shell = yield* projections.getThreadShell(event.threadId);
      if (shell === null) return;
      const thread = yield* projections.getThread(event.threadId);
      const now = yield* DateTime.now;
      const turnBeganAt = automationSnoozeTurnBegan({
        shell,
        thread,
        completedRunId: event.payload.id,
        nowMs: DateTime.toEpochMillis(now),
      });
      if (turnBeganAt === null) return;
      yield* engine.dispatch({
        type: "thread.auto-snooze",
        commandId: CommandId.make(`server:automation-snooze:${event.payload.id}`),
        threadId: event.threadId,
        snapshotAt: shell.updatedAt,
        turnBeganAt,
        snoozedUntil: DateTime.formatIso(DateTime.addDuration(now, AUTOMATION_SNOOZE)),
      });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("snoozing a finished Automation thread failed", {
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: AutomationSnoozeReactor["Service"]["start"] = Effect.fn(
    "AutomationSnoozeReactor.start",
  )(function* () {
    const scope = yield* Effect.scope;
    yield* forkParked(
      Stream.runForEach(Stream.filter(engine.streamDomainEvents, isCompletedRun), (event) =>
        // Each finished turn waits out its own grace without holding up the next event.
        Effect.forkIn(handle(event), scope),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Automation snooze event stream failed", { cause }),
        ),
      ),
    );
  });

  return { start, handle } satisfies AutomationSnoozeReactor["Service"];
});

export const layer = Layer.effect(AutomationSnoozeReactor, make);
