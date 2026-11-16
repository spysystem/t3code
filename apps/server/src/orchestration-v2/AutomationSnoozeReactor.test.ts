import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadSpace,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as AutomationSnoozeReactor from "./AutomationSnoozeReactor.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for the snooze reactor"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = AutomationSnoozeReactor.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
      EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
      ProviderReplayHarness.layerWithRegistry(
        { name: "automation-snooze" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: layerDatabase, runEffectWorker: false },
      ),
    ),
  ),
);

const startBotTurn = (space: OrchestrationV2ThreadSpace, sentBy: "agent" | "user") =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* TestClock.adjust("1 hour");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create"),
      threadId,
      projectId: ProjectId.make("project:automation-snooze"),
      space,
      title: "Review spysystem/t3code#8",
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "agent",
      creationSource: "mcp",
    });
    yield* TestClock.adjust("1 minute");
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("start"),
      threadId,
      messageId: MessageId.make("message:start"),
      text: "Review the pull request",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: sentBy,
      creationSource: sentBy === "user" ? "web" : "mcp",
    });
    return (yield* projections.getThreadProjection(threadId)).runs[0]!;
  });

const finishTurn = (
  run: Effect.Success<ReturnType<typeof startBotTurn>>,
  status: "completed" | "failed",
) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const finished = {
      id: EventId.make("event:run-finished"),
      type: "run.updated",
      threadId,
      runId: run.id,
      occurredAt: now,
      payload: { ...run, status, completedAt: now },
    } satisfies OrchestrationV2DomainEvent;
    yield* (yield* EventSink.EventSinkV2).write({ events: [finished] });
    return finished;
  });

const visit = (commandId: string) =>
  Effect.gen(function* () {
    yield* (yield* Orchestrator.OrchestratorV2).dispatch({
      type: "thread.visit",
      commandId: CommandId.make(commandId),
      threadId,
      visitedAt: DateTime.formatIso(yield* DateTime.now),
    });
  });

const threadId = ThreadId.make("thread:automation-snooze");

interface Scenario {
  readonly name: string;
  readonly space: OrchestrationV2ThreadSpace;
  readonly sentBy: "agent" | "user";
  readonly status: "completed" | "failed";
  readonly duringTurn?: "visit";
  readonly afterTurn?: "visit" | "move to Development";
  readonly snoozed: boolean;
}

it.effect.each<Scenario>([
  {
    name: "a quiet bot turn",
    space: "automation",
    sentBy: "agent",
    status: "completed",
    snoozed: true,
  },
  {
    name: "a Development thread",
    space: "development",
    sentBy: "agent",
    status: "completed",
    snoozed: false,
  },
  { name: "a failed run", space: "automation", sentBy: "agent", status: "failed", snoozed: false },
  {
    name: "a turn the user wrote",
    space: "automation",
    sentBy: "user",
    status: "completed",
    snoozed: false,
  },
  {
    name: "a turn someone watched",
    space: "automation",
    sentBy: "agent",
    status: "completed",
    duringTurn: "visit",
    snoozed: false,
  },
  {
    // The client throttles visits, so a reader's visit for a short turn lands after it ends.
    name: "a reader whose visit lands after the turn",
    space: "automation",
    sentBy: "agent",
    status: "completed",
    afterTurn: "visit",
    snoozed: false,
  },
  {
    name: "a thread moved out while the grace runs",
    space: "automation",
    sentBy: "agent",
    status: "completed",
    afterTurn: "move to Development",
    snoozed: false,
  },
])("snoozes after the turn: $name -> $snoozed", (scenario) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const reactor = yield* AutomationSnoozeReactor.AutomationSnoozeReactor;
    const run = yield* startBotTurn(scenario.space, scenario.sentBy);
    yield* TestClock.adjust("1 minute");
    if (scenario.duringTurn === "visit") yield* visit("visit-during-turn");
    yield* TestClock.adjust("5 minutes");
    const finished = yield* finishTurn(run, scenario.status);

    const reaction = yield* reactor.handle(finished).pipe(Effect.forkChild);
    yield* TestClock.adjust("2 seconds");
    if (scenario.afterTurn === "visit") yield* visit("visit-after-turn");
    if (scenario.afterTurn === "move to Development") {
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("move-out"),
        threadId,
        space: "development",
      });
    }
    yield* TestClock.adjust("13 seconds");
    yield* Fiber.join(reaction);

    const shell = yield* projections.getThreadShell(threadId);
    assert.equal(
      shell?.snoozedUntil == null ? null : DateTime.formatIso(shell.snoozedUntil),
      scenario.snoozed
        ? DateTime.formatIso(DateTime.add(yield* DateTime.now, { days: 365 }))
        : null,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each(["nothing", "a visit", "a user message"] as const)(
  "the auto-snooze command checks what happened after the reactor's read: %s",
  (afterRead) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const run = yield* startBotTurn("automation", "agent");
      yield* TestClock.adjust("5 minutes");
      yield* finishTurn(run, "completed");
      const read = yield* projections.getThreadShell(threadId);
      assert.ok(read);

      yield* TestClock.adjust("1 second");
      if (afterRead === "a visit") yield* visit("visit-after-read");
      if (afterRead === "a user message") {
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("user-follow-up"),
          threadId,
          messageId: MessageId.make("message:user-follow-up"),
          text: "One more thing",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
      }
      const snoozed = yield* orchestrator
        .dispatch({
          type: "thread.auto-snooze",
          commandId: CommandId.make("auto-snooze"),
          threadId,
          snapshotAt: read.updatedAt,
          turnBeganAt: read.latestRunRequestedAt!,
          snoozedUntil: DateTime.formatIso(DateTime.add(yield* DateTime.now, { days: 365 })),
        })
        .pipe(Effect.exit);

      assert.equal(snoozed._tag, afterRead === "nothing" ? "Success" : "Failure");
      assert.equal(
        (yield* projections.getThreadShell(threadId))?.snoozedUntil != null,
        afterRead === "nothing",
      );
    }).pipe(Effect.provide(layerTest)),
);
