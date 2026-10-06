import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { msg } from "gt-react";

import { toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { type ClipboardTarget, writeTextToClipboard } from "./useCopyToClipboard";

const NATIVE_THREAD_ID_TARGET: ClipboardTarget = {
  target: "native thread ID",
  unavailableMessage: msg("Clipboard API is unavailable while copying the native thread ID."),
  failureMessage: msg("Failed to copy the native thread ID to the clipboard."),
};

export function useCopyNativeThreadId() {
  const getNativeThreadId = useAtomCommand(threadEnvironment.getNativeThreadId, {
    reportFailure: false,
  });

  return async (threadRef: ScopedThreadRef) => {
    const result = await getNativeThreadId({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: m(msg("Failed to read native thread ID")),
        description: error instanceof Error ? error.message : m(msg("An error occurred.")),
      });
      return;
    }
    const { nativeThreadId } = result.value;
    if (nativeThreadId === null) {
      toastManager.add({
        type: "info",
        title: m(msg("Native thread ID unavailable")),
        description: m(msg("This thread does not have a saved native provider ID.")),
      });
      return;
    }
    try {
      if (await writeTextToClipboard(nativeThreadId, NATIVE_THREAD_ID_TARGET)) {
        toastManager.add({
          type: "success",
          title: m(msg("Native thread ID copied")),
          description: nativeThreadId,
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: m(msg("Failed to copy native thread ID")),
        description: error instanceof Error ? error.message : m(msg("An error occurred.")),
      });
    }
  };
}
