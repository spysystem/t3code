import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  IsoDateTime,
  ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScheduledTask,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "./McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";

const threadId = ThreadId.make("thread:gate-caller");
const gate = { command: "node mentions.mjs" };
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:gate"),
  requestNamespace: "provider-session:gate",
  thread: {
    threadId,
    providerSessionId: "provider-session:gate",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

/** A caller thread and a task bound to it, both at the given modes. */
const withCaller = <A, E>(
  modes: { readonly runtimeMode: RuntimeMode; readonly interactionMode: ProviderInteractionMode },
  use: (
    service: OrchestratorMcpService.OrchestratorMcpService["Service"],
    upserts: Ref.Ref<ReadonlyArray<ScheduledTaskUpsertInput>>,
    task: ScheduledTask,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const shell = liveThreadShell(threadId, modes);
    const timestamp = IsoDateTime.make("2026-10-21T22:00:00.000Z");
    const task: ScheduledTask = {
      id: ScheduledTaskId.make("task:gate"),
      title: "Mentions",
      prompt: "Handle {{gate.output}}",
      enabled: true,
      schedule: { type: "interval", everyMs: 600_000 },
      projectId: shell.projectId,
      threadId,
      workspaceStrategy: { type: "root" },
      modelSelection: shell.modelSelection,
      ...modes,
      createdBy: "agent",
      creationSource: "mcp",
      createdAt: timestamp,
      updatedAt: timestamp,
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: "never",
      lastRunError: null,
      runCount: 0,
    };
    const upserts = yield* Ref.make<ReadonlyArray<ScheduledTaskUpsertInput>>([]);
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: () => Effect.succeed(idleThreadProjection(shell)),
        getThreadShell: () => Effect.succeed(shell),
      }),
      ServerSettings.layerTest(),
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
      Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
        list: () => Effect.succeed([]),
      }),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({
        list: () => Effect.succeed({ tasks: [task] }),
        upsert: (input) => Ref.update(upserts, (all) => [...all, input]).pipe(Effect.as({ task })),
      }),
    );
    return yield* Effect.gen(function* () {
      return yield* use(yield* OrchestratorMcpService.OrchestratorMcpService, upserts, task);
    }).pipe(
      Effect.provide(
        OrchestratorMcpService.layer.pipe(
          Layer.provide(Layer.mock(ThreadLaunchService.ThreadLaunchService)({})),
          Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
          Layer.provide(dependencies),
        ),
      ),
    );
  });

describe("scheduled task gates over MCP", () => {
  it.effect("schedule_task with a gate is rejected unless the caller is full-access", () =>
    withCaller({ runtimeMode: "auto", interactionMode: "default" }, (service, upserts) =>
      Effect.gen(function* () {
        const error = yield* service
          .scheduleTask(scope, {
            prompt: "Handle {{gate.output}}",
            schedule: { type: "interval", everyMs: 600_000, gate },
          })
          .pipe(Effect.flip);
        assert.equal(error.code, "capability_denied");
        assert.include(error.message, "full-access");
        assert.deepEqual(yield* Ref.get(upserts), []);
      }),
    ),
  );

  it.effect("update_scheduled_task may not add a gate below full-access, but may remove one", () =>
    withCaller({ runtimeMode: "auto", interactionMode: "default" }, (service, upserts, task) =>
      Effect.gen(function* () {
        const error = yield* service
          .updateScheduledTask(scope, {
            scheduledTaskId: task.id,
            schedule: { type: "interval", everyMs: 600_000, gate },
          })
          .pipe(Effect.flip);
        assert.equal(error.code, "capability_denied");

        yield* service.updateScheduledTask(scope, { scheduledTaskId: task.id, enabled: false });
        yield* service.updateScheduledTask(scope, {
          scheduledTaskId: task.id,
          schedule: { type: "interval", everyMs: 600_000, gate: null },
        });
        assert.deepEqual(
          (yield* Ref.get(upserts)).map((input) => input.schedule),
          [
            { type: "interval", everyMs: 600_000 },
            { type: "interval", everyMs: 600_000, gate: null },
          ],
        );
      }),
    ),
  );

  it.effect("a full-access thread in plan mode may not set a gate", () =>
    withCaller({ runtimeMode: "full-access", interactionMode: "plan" }, (service, upserts) =>
      Effect.gen(function* () {
        const error = yield* service
          .scheduleTask(scope, {
            prompt: "Handle {{gate.output}}",
            schedule: { type: "interval", everyMs: 600_000, gate },
          })
          .pipe(Effect.flip);
        assert.equal(error.code, "capability_denied");
        assert.deepEqual(yield* Ref.get(upserts), []);
      }),
    ),
  );

  it.effect("a full-access caller may set a gate", () =>
    withCaller(
      { runtimeMode: "full-access", interactionMode: "default" },
      (service, upserts, task) =>
        Effect.gen(function* () {
          yield* service.updateScheduledTask(scope, {
            scheduledTaskId: task.id,
            schedule: { type: "interval", everyMs: 600_000, gate },
          });
          assert.deepEqual(
            (yield* Ref.get(upserts)).map((input) => input.schedule),
            [{ type: "interval", everyMs: 600_000, gate }],
          );
        }),
    ),
  );
});
