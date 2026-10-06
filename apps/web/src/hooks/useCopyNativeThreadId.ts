import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { toastManager } from "../components/ui/toast";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { writeTextToClipboard } from "./useCopyToClipboard";

export function useCopyNativeThreadId() {
  const getNativeThreadId = useAtomCommand(threadEnvironment.getNativeThreadId, {
    reportFailure: false,
  });

  return useCallback(
    async (threadRef: ScopedThreadRef) => {
      const result = await getNativeThreadId({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Failed to read native thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        return;
      }
      const { nativeThreadId } = result.value;
      if (nativeThreadId === null) {
        toastManager.add({
          type: "info",
          title: "Native thread ID unavailable",
          description: "This thread does not have a saved native provider ID.",
        });
        return;
      }
      try {
        if (await writeTextToClipboard(nativeThreadId, "native thread ID")) {
          toastManager.add({
            type: "success",
            title: "Native thread ID copied",
            description: nativeThreadId,
          });
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to copy native thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [getNativeThreadId],
  );
}
