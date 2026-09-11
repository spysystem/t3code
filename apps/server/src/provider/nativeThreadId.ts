import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { ProviderRuntimeBinding } from "./Services/ProviderSessionDirectory.ts";

const decodeThreadCursor = Schema.decodeUnknownOption(
  Schema.Struct({ threadId: TrimmedNonEmptyString }),
);
const decodeSessionCursor = Schema.decodeUnknownOption(
  Schema.Struct({ sessionId: TrimmedNonEmptyString }),
);
const decodeClaudeCursor = Schema.decodeUnknownOption(
  Schema.Struct({ resume: TrimmedNonEmptyString }),
);

/** Reads provider-owned resume identity without exposing the rest of the persisted cursor. */
export function readNativeThreadId(binding: ProviderRuntimeBinding): string | null {
  switch (binding.provider) {
    case "codex": {
      const cursor = decodeThreadCursor(binding.resumeCursor);
      return cursor._tag === "Some" ? cursor.value.threadId : null;
    }
    case "claudeAgent": {
      // Claude's threadId is T3's ID; resume (legacy: sessionId) is the SDK session ID.
      const cursor = decodeClaudeCursor(binding.resumeCursor);
      if (cursor._tag === "Some") return cursor.value.resume;
      const legacy = decodeSessionCursor(binding.resumeCursor);
      return legacy._tag === "Some" ? legacy.value.sessionId : null;
    }
    case "cursor":
    case "grok":
    case "opencode":
    case "antigravity": {
      const cursor = decodeSessionCursor(binding.resumeCursor);
      return cursor._tag === "Some" ? cursor.value.sessionId : null;
    }
    default:
      return null;
  }
}
