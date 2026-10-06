import { ProviderDriverKind, ProviderThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readNativeThreadId } from "./nativeThreadId.ts";

function providerThread(id: string, nativeId: string | null) {
  return {
    id: ProviderThreadId.make(id),
    nativeThreadRef: {
      driver: ProviderDriverKind.make("codex"),
      nativeId,
      strength: nativeId === null ? ("none" as const) : ("strong" as const),
    },
  };
}

describe("native thread identity", () => {
  it("reads the active provider thread after a handoff", () => {
    expect(
      readNativeThreadId({
        thread: { activeProviderThreadId: ProviderThreadId.make("first") },
        providerThreads: [providerThread("first", "native-first"), providerThread("second", "x")],
      }),
    ).toBe("native-first");
  });

  it("falls back to the latest provider thread when none is active", () => {
    expect(
      readNativeThreadId({
        thread: { activeProviderThreadId: null },
        providerThreads: [providerThread("first", "native-first"), providerThread("second", "y")],
      }),
    ).toBe("y");
  });

  it("returns no identity before a provider thread exists or has a native ID", () => {
    expect(
      readNativeThreadId({ thread: { activeProviderThreadId: null }, providerThreads: [] }),
    ).toBeNull();
    expect(
      readNativeThreadId({
        thread: { activeProviderThreadId: ProviderThreadId.make("first") },
        providerThreads: [providerThread("first", null)],
      }),
    ).toBeNull();
  });
});
