import { McpCapabilityUnavailableError, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export class ChatRenameFailedError extends Schema.TaggedError<ChatRenameFailedError>()(
  "ChatRenameFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not rename the current chat. The thread may no longer exist.";
  }
}

const RenameChatTool = Tool.make("rename_chat", {
  description:
    "Rename the current T3 Code chat. Use when the user requests a rename or a skill directs you to give the conversation a useful title. Skill-directed renames are allowed without a separate user request. This is the T3 Code equivalent of Cursor's rename_chat tool and always targets the calling thread. You may update the title again as the task changes.",
  parameters: Schema.Struct({
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)).annotate({
      description:
        "New title for the current chat, up to 200 characters. Surrounding whitespace is trimmed.",
    }),
  }),
  success: Schema.Struct({ title: Schema.String }),
  failure: Schema.Union([McpCapabilityUnavailableError, ChatRenameFailedError]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    OrchestrationEngine.OrchestrationEngineService,
  ],
})
  .annotate(Tool.Title, "Rename chat")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadsToolkit = Toolkit.make(RenameChatTool);
