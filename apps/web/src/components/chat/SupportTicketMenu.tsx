import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ChevronDownIcon } from "lucide-react";
import { memo } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { newMessageId } from "../../lib/utils";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import {
  DEV_SUPPORT_FOLLOW_UP_LABELS,
  type DevSupportFollowUp,
  devSupportFollowUpPrompt,
} from "../devSupportTicket.logic";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";

const FOLLOW_UPS: ReadonlyArray<DevSupportFollowUp> = ["split-task"];

/**
 * Support actions for a ticket thread: copy the agent's reply for the
 * supporter, or send one of the usual follow-ups straight to the agent.
 */
export const SupportTicketMenu = memo(function SupportTicketMenu({
  thread,
  taskId,
  readSupporterReply,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly taskId: string;
  /** Read on demand so a streaming answer does not re-render the header. */
  readonly readSupporterReply: () => string | null;
}) {
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const { copyToClipboard } = useCopyToClipboard({
    target: "reply",
    onCopy: () => {
      toastManager.add({ type: "success", title: "Reply copied" });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy reply",
          description: error.message,
        }),
      );
    },
  });

  const copyReply = () => {
    const reply = readSupporterReply();
    if (reply === null) {
      toastManager.add({
        type: "info",
        title: "No reply to supporter yet",
        description: "The agent adds it when it answers the ticket.",
      });
      return;
    }
    copyToClipboard(reply, undefined);
  };

  const sendFollowUp = async (followUp: DevSupportFollowUp) => {
    const result = await startThreadTurn({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: devSupportFollowUpPrompt(followUp, taskId),
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to send "${DEV_SUPPORT_FOLLOW_UP_LABELS[followUp]}"`,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button type="button" variant="ghost-muted" size="xs" aria-label="Support actions" />
        }
      >
        Support
        <ChevronDownIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem onClick={copyReply}>Copy reply to supporter</MenuItem>
        <MenuSeparator />
        {FOLLOW_UPS.map((followUp) => (
          <MenuItem key={followUp} onClick={() => void sendFollowUp(followUp)}>
            {DEV_SUPPORT_FOLLOW_UP_LABELS[followUp]}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
});
