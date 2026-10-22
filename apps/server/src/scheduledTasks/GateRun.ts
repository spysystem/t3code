/**
 * One tick of a gated scheduled task (SPY fork). The gate runs before the task
 * is marked running, so a tick that starts no turn is settled here: a quiet
 * check only moves the next run, a failing one records a failed run.
 *
 * Gate state lives in its own table, created on startup rather than by a
 * numbered migration: the fork rebases onto upstream, whose next migration
 * would reuse any number taken here and then never run on databases that ran
 * ours.
 */
import type {
  ScheduledTask,
  ScheduledTaskError,
  ScheduledTaskGate,
  ScheduledTaskId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as Gate from "./Gate.ts";

/** The failing check that starts a turn with the error; one per run of failures. */
export const GATE_FAILURES_BEFORE_TURN = 3;

const localNow = DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);
const iso = (value: DateTime.DateTime) => DateTime.formatIso(DateTime.toUtc(value));

export const ensureGateStateTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_task_gate_state (
      task_id TEXT PRIMARY KEY,
      checked_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      failure_turn_sent INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS scheduled_task_gate_state_cleanup
    AFTER DELETE ON scheduled_tasks
    BEGIN
      DELETE FROM scheduled_task_gate_state WHERE task_id = old.task_id;
    END
  `;
});

/**
 * Records a check. A failure adds to the count; a success clears the count and
 * the failure-turn flag. Conditional on the task existing, so a check
 * finishing after a delete leaves nothing a recreated task would inherit.
 */
const recordCheck = Effect.fn("ScheduledTaskGate.recordCheck")(function* (
  taskId: ScheduledTaskId,
  checkedAtIso: string,
  failed: boolean,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ failure_count: number; failure_turn_sent: number }>`
    INSERT INTO scheduled_task_gate_state (task_id, checked_at, failure_count, failure_turn_sent)
    SELECT ${taskId}, ${checkedAtIso}, ${failed ? 1 : 0}, 0
    WHERE EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_id = ${taskId})
    ON CONFLICT (task_id) DO UPDATE SET
      checked_at = excluded.checked_at,
      failure_count = CASE WHEN ${failed ? 1 : 0} = 1 THEN failure_count + 1 ELSE 0 END,
      failure_turn_sent = CASE WHEN ${failed ? 1 : 0} = 1 THEN failure_turn_sent ELSE 0 END
    RETURNING failure_count, failure_turn_sent
  `;
  return {
    failures: rows[0]?.failure_count ?? 0,
    turnSent: rows[0]?.failure_turn_sent === 1,
  };
});

/** Called once the failure turn has been dispatched, so the next failure sends none. */
export const markFailureTurnSent = Effect.fn("ScheduledTaskGate.markFailureTurnSent")(function* (
  taskId: ScheduledTaskId,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE scheduled_task_gate_state SET failure_turn_sent = 1 WHERE task_id = ${taskId}
  `;
});

/** Forgets the count and flag, for a gate that changed or was removed. */
export const resetGateState = Effect.fn("ScheduledTaskGate.resetGateState")(function* (
  taskId: ScheduledTaskId,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM scheduled_task_gate_state WHERE task_id = ${taskId}`;
});

export const readGateCheckTimes = Effect.fn("ScheduledTaskGate.readGateCheckTimes")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ task_id: string; checked_at: string | null }>`
    SELECT task_id, checked_at FROM scheduled_task_gate_state
  `;
  return new Map(rows.map((row) => [row.task_id, row.checked_at]));
});

export interface GateTick {
  readonly task: ScheduledTask;
  readonly gate: ScheduledTaskGate;
  readonly trigger: "scheduled" | "manual";
  readonly startedAtIso: string;
}

/** The scheduled-task service's own run bookkeeping, which a settled tick reuses. */
export interface GateTickHooks {
  readonly findTask: (
    id: ScheduledTaskId,
  ) => Effect.Effect<ScheduledTask | null, ScheduledTaskError>;
  readonly nextRunAt: (task: ScheduledTask, from: DateTime.DateTime) => string | null;
  readonly recordFailedRun: (input: {
    readonly id: ScheduledTaskId;
    readonly startedAtIso: string;
    readonly completedAtIso: string;
    readonly nextRunAtIso: string | null;
    readonly error: string;
  }) => Effect.Effect<void, ScheduledTaskError>;
  readonly notifyChanged: Effect.Effect<void>;
}

export type GateTickOutcome =
  | { readonly _tag: "settled"; readonly task: ScheduledTask }
  /**
   * `task` is re-read after the gate ran, so the turn starts from the task as
   * it is now. `gateError` is set for the failure turn, which leaves the run
   * marked failed.
   */
  | {
      readonly _tag: "turn";
      readonly task: ScheduledTask;
      readonly prompt: string;
      readonly gateError: string | null;
    };

const STATE_ERROR = "The gate ran, but its result could not be saved.";

/**
 * Runs the gate and decides the tick. News starts a turn with the output;
 * the first failure at or past `GATE_FAILURES_BEFORE_TURN` whose turn has not
 * been sent starts one with the error. Anything else settles here, as a quiet
 * check or a failed run; one whose state cannot be saved too, so a broken state
 * table cannot make the gate run on every poll.
 */
export const checkGate = Effect.fn("ScheduledTaskGate.checkGate")(function* (
  tick: GateTick,
  hooks: GateTickHooks,
) {
  const runGate = yield* Gate.ScheduledTaskGateRunner;
  const crypto = yield* Crypto.Crypto;
  const { task } = tick;
  const result = yield* runGate({ projectId: task.projectId, gate: tick.gate });
  const checkedAt = yield* localNow;
  const checkedAtIso = iso(checkedAt);
  // The gate can run for minutes; everything after it works from the task as
  // it is now.
  const current = yield* hooks.findTask(task.id);
  if (current === null || current.createdAt !== task.createdAt) {
    return { _tag: "settled", task } satisfies GateTickOutcome;
  }
  // A check of a gate that changed meanwhile counts for nothing. The task is
  // still due, so the next poll runs whatever it has now.
  if (!Gate.isSameGate(Gate.scheduleGate(current.schedule), tick.gate)) {
    return { _tag: "settled", task: current } satisfies GateTickOutcome;
  }
  const state = yield* recordCheck(task.id, checkedAtIso, result._tag === "failed").pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Could not save scheduled task gate state", { taskId: task.id, cause }),
    ),
    Effect.option,
  );
  const checked: ScheduledTask =
    state._tag === "Some" ? { ...current, gateCheckedAt: checkedAtIso } : current;
  if (tick.trigger === "scheduled" && !current.enabled) {
    yield* hooks.notifyChanged;
    return { _tag: "settled", task: checked } satisfies GateTickOutcome;
  }
  // News starts its turn even when its state could not be saved: the run's
  // own bookkeeping moves the next run. A failure turn needs the saved count.
  const failureTurnDue =
    result._tag === "failed" &&
    state._tag === "Some" &&
    state.value.failures >= GATE_FAILURES_BEFORE_TURN &&
    !state.value.turnSent;
  if (result._tag === "news" || failureTurnDue) {
    const frameId = yield* crypto.randomBytes(6).pipe(
      Effect.map((bytes) => Buffer.from(bytes).toString("hex")),
      Effect.orDie,
    );
    return result._tag === "news"
      ? ({
          _tag: "turn",
          task: current,
          prompt: Gate.renderGatePrompt(current.prompt, { output: result.output }, frameId),
          gateError: null,
        } satisfies GateTickOutcome)
      : ({
          _tag: "turn",
          task: current,
          prompt: Gate.renderGatePrompt(current.prompt, { error: result.error }, frameId),
          gateError: result.error,
        } satisfies GateTickOutcome);
  }
  const next = hooks.nextRunAt(current, checkedAt);
  const error =
    result._tag === "failed"
      ? state._tag === "None"
        ? `${STATE_ERROR}\n${result.error}`
        : result.error
      : state._tag === "None"
        ? STATE_ERROR
        : null;
  if (error === null) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE scheduled_tasks
      SET next_run_at = ${next}
      WHERE task_id = ${task.id} AND created_at = ${task.createdAt}
    `;
    yield* hooks.notifyChanged;
    return { _tag: "settled", task: { ...checked, nextRunAt: next } } satisfies GateTickOutcome;
  }
  yield* hooks.recordFailedRun({
    id: task.id,
    startedAtIso: tick.startedAtIso,
    completedAtIso: checkedAtIso,
    nextRunAtIso: next,
    error,
  });
  yield* hooks.notifyChanged;
  return {
    _tag: "settled",
    task: {
      ...checked,
      updatedAt: checkedAtIso,
      nextRunAt: next,
      lastRunAt: tick.startedAtIso,
      lastRunStatus: "failed",
      lastRunError: error,
      runCount: current.runCount + 1,
    },
  } satisfies GateTickOutcome;
});
