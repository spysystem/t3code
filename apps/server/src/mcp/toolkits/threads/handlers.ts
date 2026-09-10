import { CommandId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ChatRenameFailedError, ThreadsToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  return ThreadsToolkit.of({
    rename_chat: Effect.fn("ThreadsToolkit.renameChat")(function* ({ title }) {
      const { threadId } = yield* McpInvocationContext.requireMcpCapability("thread-metadata");
      const uuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      yield* engine
        .dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make(`server:mcp-rename-chat:${threadId}:${uuid}`),
          threadId,
          title,
        })
        .pipe(Effect.mapError((cause) => new ChatRenameFailedError({ cause })));
      return { title };
    }),
  });
});

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(make);
