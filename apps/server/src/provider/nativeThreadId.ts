import type { OrchestrationV2AppThread, OrchestrationV2ProviderThread } from "@t3tools/contracts";

/**
 * Reads the native ID of the provider thread serving an app thread: the active
 * provider thread, else the latest one, matching how provider RPCs pick a thread.
 */
export function readNativeThreadId(projection: {
  readonly thread: Pick<OrchestrationV2AppThread, "activeProviderThreadId">;
  readonly providerThreads: ReadonlyArray<
    Pick<OrchestrationV2ProviderThread, "id" | "nativeThreadRef">
  >;
}): string | null {
  const providerThread =
    projection.providerThreads.find(
      (candidate) => candidate.id === projection.thread.activeProviderThreadId,
    ) ?? projection.providerThreads.at(-1);
  return providerThread?.nativeThreadRef?.nativeId ?? null;
}
