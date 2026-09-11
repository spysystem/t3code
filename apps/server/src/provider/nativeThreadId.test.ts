import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readNativeThreadId } from "./nativeThreadId.ts";

function read(provider: string, resumeCursor: unknown) {
  return readNativeThreadId({
    threadId: ThreadId.make("t3-thread"),
    provider: ProviderDriverKind.make(provider),
    resumeCursor,
  });
}

describe("native thread identity", () => {
  it("returns Codex's saved identity", () => {
    expect(read("codex", { threadId: "codex-native" })).toBe("codex-native");
  });

  it("uses Claude's SDK identity instead of the T3 thread ID", () => {
    expect(read("claudeAgent", { threadId: "t3-thread", resume: "claude-native" })).toBe(
      "claude-native",
    );
    expect(read("claudeAgent", { threadId: "t3-thread", sessionId: "legacy-native" })).toBe(
      "legacy-native",
    );
    expect(read("claudeAgent", { threadId: "t3-thread" })).toBeNull();
  });

  it.each(["cursor", "grok", "opencode", "antigravity"])(
    "reads %s session identity",
    (provider) => {
      expect(read(provider, { schemaVersion: 1, sessionId: "native-session" })).toBe(
        "native-session",
      );
    },
  );

  it.each([undefined, null, {}, { threadId: "" }, { threadId: 42 }, "native-id"])(
    "returns no identity for an unavailable or malformed cursor %j",
    (cursor) => {
      expect(read("codex", cursor)).toBeNull();
    },
  );

  it("does not guess the cursor format of an unknown provider", () => {
    expect(read("custom", { threadId: "maybe-t3", sessionId: "maybe-native" })).toBeNull();
  });
});
