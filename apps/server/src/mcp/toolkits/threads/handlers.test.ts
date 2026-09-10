import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { ServerConfig } from "../../../config.ts";
import { OrchestrationEngineLive } from "../../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import { ThreadsToolkitRegistrationLive } from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const OrchestrationTestLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-rename-chat-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const TestLayer = ThreadsToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(OrchestrationTestLayer),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "rename-chat-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "rename-chat-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const invocation = (
  threadId: ThreadId,
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["thread-metadata"],
): McpInvocationContext.McpInvocationScope => ({
  threadId,
  environmentId: EnvironmentId.make("test-environment"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: `session:${threadId}`,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const makeHarness = Effect.fn("makeRenameChatHarness")(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const server = yield* McpServer.McpServer;
  const projectId = ProjectId.make("rename-project");
  const threadId = ThreadId.make("rename-thread");
  const otherThreadId = ThreadId.make("other-thread");
  const createdAt = "2026-09-10T00:00:00.000Z";
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("create-project"),
    projectId,
    title: "Rename test",
    workspaceRoot: process.cwd(),
    createdAt,
  });
  for (const id of [threadId, otherThreadId]) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${id}`),
      threadId: id,
      projectId,
      title: "Existing title",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });
  }
  const rename = (args: Record<string, unknown>, scope = invocation(threadId)) =>
    server
      .callTool({ name: "rename_chat", arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  const readThread = (id = threadId) =>
    snapshots.getThreadShellById(id).pipe(Effect.map(Option.getOrThrow));
  return { engine, server, threadId, otherThreadId, rename, readThread };
});

it.effect("renames the calling thread, persists its event, and supports repeated renames", () =>
  Effect.gen(function* () {
    const { engine, threadId, otherThreadId, rename, readThread } = yield* makeHarness();
    const sequenceBefore = yield* engine.latestSequence;
    const result = yield* rename({ title: "  Implement #12345 stock reservations  " });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ title: "Implement #12345 stock reservations" });
    expect((yield* readThread()).title).toBe("Implement #12345 stock reservations");
    expect((yield* readThread(otherThreadId)).title).toBe("Existing title");

    const events = yield* engine.readEvents(sequenceBefore).pipe(Stream.runCollect);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thread.meta-updated",
      payload: { threadId, title: "Implement #12345 stock reservations" },
    });

    for (const title of ["Test #12345 stock reservations", "Test #12345 stock reservations"]) {
      expect((yield* rename({ title })).isError).toBe(false);
      expect((yield* readThread()).title).toBe(title);
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps simultaneous calls scoped to their own threads", () =>
  Effect.gen(function* () {
    const { threadId, otherThreadId, rename, readThread } = yield* makeHarness();
    const results = yield* Effect.all(
      [
        rename({ title: "First thread" }, invocation(threadId)),
        rename({ title: "Second thread", threadId }, invocation(otherThreadId)),
      ],
      { concurrency: "unbounded" },
    );
    expect(results.every((result) => !result.isError)).toBe(true);
    expect((yield* readThread(threadId)).title).toBe("First thread");
    expect((yield* readThread(otherThreadId)).title).toBe("Second thread");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects invalid titles without changing the thread", () =>
  Effect.gen(function* () {
    const { rename, readThread } = yield* makeHarness();
    for (const args of [
      {},
      { title: "" },
      { title: " \n\t " },
      { title: "x".repeat(201) },
      { title: 42 },
    ]) {
      const error = yield* rename(args).pipe(Effect.flip);
      expect(error).toBeInstanceOf(McpSchema.InvalidParams);
      expect((yield* readThread()).title).toBe("Existing title");
    }
    expect((yield* rename({ title: "x".repeat(200) })).isError).toBe(false);
    expect((yield* readThread()).title).toHaveLength(200);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("requires the thread capability and reports missing threads as tool errors", () =>
  Effect.gen(function* () {
    const { threadId, rename, readThread } = yield* makeHarness();
    const denied = yield* rename(
      { title: "Denied" },
      invocation(threadId, ["preview", "pull-requests"]),
    );
    expect(denied.isError).toBe(true);
    expect(denied.content).toEqual([
      { type: "text", text: "MCP credential does not grant the thread-metadata capability." },
    ]);
    const missing = yield* rename(
      { title: "Missing" },
      invocation(ThreadId.make("missing-thread")),
    );
    expect(missing.isError).toBe(true);
    expect(missing.content).toEqual([
      { type: "text", text: "Could not rename the current chat. The thread may no longer exist." },
    ]);
    expect((yield* readThread()).title).toBe("Existing title");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "supersedes pending title regeneration and preserves agent names against automatic titles",
  () =>
    Effect.gen(function* () {
      const { engine, threadId, rename, readThread } = yield* makeHarness();
      const previousTitle = (yield* readThread()).title;
      const requestId = CommandId.make("regenerate-title");
      yield* engine.dispatch({
        type: "thread.meta.update",
        commandId: requestId,
        threadId,
        regenerateTitle: true,
      });
      expect((yield* readThread()).titleRegeneration?.requestId).toBe(requestId);

      expect((yield* rename({ title: "Skill-selected title" })).isError).toBe(false);
      expect((yield* readThread()).titleRegeneration).toBeNull();
      yield* engine.dispatch({
        type: "thread.title.regeneration.complete",
        commandId: CommandId.make("finish-regeneration"),
        threadId,
        requestId,
        title: "Late regenerated title",
      });
      yield* engine.dispatch({
        type: "thread.title.generate.complete",
        commandId: CommandId.make("late-automatic-title"),
        threadId,
        title: "Late first-turn title",
        expectedTitle: previousTitle,
        expectedVersion: requestId,
        needsRefinement: false,
      });
      expect((yield* readThread()).title).toBe("Skill-selected title");

      const renamedThread = yield* readThread();
      expect(renamedThread.titleState?.source).toBe("manual");
      yield* engine.dispatch({
        type: "thread.title.generate.complete",
        commandId: CommandId.make("matching-automatic-title"),
        threadId,
        title: "Matching title update",
        expectedTitle: "Skill-selected title",
        expectedVersion: renamedThread.titleState?.version ?? null,
        needsRefinement: false,
      });
      expect((yield* readThread()).title).toBe("Skill-selected title");
    }).pipe(Effect.provide(TestLayer)),
);
