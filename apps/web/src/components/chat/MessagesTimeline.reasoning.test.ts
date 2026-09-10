import { describe, expect, it } from "vite-plus/test";
import { MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import type { ChatMessage } from "../../types";
import { deriveTimelineEntries } from "../../session-logic";
import {
  deriveMessagesTimelineRows,
  deriveMessagesTimelineRowsWithState,
} from "./MessagesTimeline.logic";

const turnId = TurnId.make("thinking-turn");
const message: ChatMessage = {
  id: MessageId.make("reasoning-1"),
  role: "reasoning",
  text: "Compare the approaches.",
  turnId,
  streaming: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
function rowsFor(
  messages: ChatMessage[],
  isWorking = true,
  expandedWorkGroupIds = new Set<string>(),
  showThinking = true,
  expandedTurnIds = new Set<TurnId>(),
) {
  return deriveMessagesTimelineRows({
    timelineEntries: deriveTimelineEntries(messages, [], []),
    showThinking,
    latestTurn: {
      turnId,
      state: isWorking ? "running" : "completed",
      startedAt: message.createdAt,
      completedAt: isWorking ? null : message.updatedAt,
    },
    runningTurnId: isWorking ? turnId : null,
    isWorking,
    activeTurnStartedAt: isWorking ? message.createdAt : null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    expandedWorkGroupIds,
    expandedTurnIds,
  });
}
describe("reasoning in the web timeline", () => {
  it.each([false, true])(
    "keeps async setup and queued messages around live thinking (visible: %s)",
    (showThinking) => {
      const rows = deriveMessagesTimelineRows({
        timelineEntries: deriveTimelineEntries([message], [], []),
        showThinking,
        latestTurn: {
          turnId,
          state: "running",
          startedAt: message.createdAt,
          completedAt: null,
        },
        runningTurnId: turnId,
        isWorking: true,
        activeTurnStartedAt: message.createdAt,
        turnDiffSummaries: [],
        supportsConversationRollback: false,
        worktreeSetup: {
          threadId: ThreadId.make("setup-thread"),
          phase: "running",
          startedAt: message.createdAt,
          endedAt: null,
          branch: "feature",
          baseRef: "main",
          worktreePath: null,
          setupScript: null,
          stages: [
            {
              id: "setup-script",
              status: "running",
              startedAt: message.createdAt,
              endedAt: null,
              percent: null,
              detail: null,
              tail: [],
            },
            {
              id: "agent",
              status: "done",
              startedAt: message.createdAt,
              endedAt: message.createdAt,
              percent: null,
              detail: null,
              tail: [],
            },
          ],
          error: null,
          sequence: 3,
        },
        queuedMessages: [
          {
            id: "next-prompt",
            prompt: "Check the result",
            images: [],
            files: [],
            terminalContexts: [],
            previewAnnotations: [],
            reviewComments: [],
            submissionIntent: "foreground",
            queuedAfterToolActivityId: null,
            createdAt: message.createdAt,
          },
        ],
      });
      expect(rows.map((row) => row.kind)).toEqual([
        "working",
        "worktree-setup",
        showThinking ? "message" : "thinking",
        "queued-message",
      ]);
      expect(rows[1]).toMatchObject({ embedded: true, snapshot: { phase: "running" } });
      expect(rows.at(-1)).toMatchObject({
        isNext: true,
        queuedMessage: { prompt: "Check the result" },
      });
    },
  );

  it.each([false, true])("folds thoughts with completed work (tools: %s)", (withTools) => {
    const messages: ChatMessage[] = [
      { ...message, streaming: false },
      {
        ...message,
        id: MessageId.make("reasoning-2"),
        createdAt: "2026-01-01T00:00:02Z",
        updatedAt: "2026-01-01T00:00:03Z",
        streaming: false,
      },
      {
        ...message,
        id: MessageId.make("reply"),
        role: "assistant",
        text: "Here is the answer.",
        createdAt: "2026-01-01T00:00:04Z",
        updatedAt: "2026-01-01T00:00:05Z",
        streaming: false,
      },
    ];
    const timelineEntries = deriveTimelineEntries(messages, [], []);
    if (withTools) {
      timelineEntries.splice(1, 0, {
        id: "work-entry",
        kind: "work",
        createdAt: "2026-01-01T00:00:01Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:01Z",
          turnId,
          label: "Ran command",
          tone: "tool",
        },
      });
    }
    const input = {
      timelineEntries,
      showThinking: true,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    };
    const collapsed = deriveMessagesTimelineRows(input);
    expect(collapsed.map((row) => row.kind)).toEqual(["turn-fold", "message"]);
    expect(collapsed[0]).toMatchObject({ label: "Worked for 5.0s", expanded: false });
    expect(collapsed[1]).toMatchObject({ message: messages[2], showAssistantMeta: true });

    const expanded = deriveMessagesTimelineRows({
      ...input,
      expandedTurnIds: new Set([turnId]),
    });
    expect(expanded.map((row) => row.id)).toEqual([
      `turn-fold:${turnId}`,
      ...timelineEntries.map((entry) => entry.id),
    ]);
    expect(expanded.filter((row) => row.kind === "message").map((row) => row.message)).toEqual(
      messages,
    );
    expect(deriveMessagesTimelineRows(input)).toEqual(collapsed);

    const running = deriveMessagesTimelineRows({
      ...input,
      isWorking: true,
      runningTurnId: turnId,
    });
    expect(running.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(running.filter((row) => row.kind === "message").map((row) => row.message)).toEqual(
      messages,
    );
  });

  it("hides live thinking when disabled and keeps the normal working indicator", () => {
    const rows = rowsFor([message], true, new Set(), false);
    expect(rows.some((row) => row.kind === "message")).toBe(false);
    expect(rows.some((row) => row.kind === "thinking")).toBe(true);
  });

  it("hides saved thoughts while retaining assistant replies", () => {
    const reply: ChatMessage = {
      ...message,
      id: MessageId.make("reply"),
      role: "assistant",
      text: "Here is the answer.",
      streaming: false,
    };
    const rows = rowsFor([{ ...message, streaming: false }, reply], false, new Set(), false);
    expect(rows.filter((row) => row.kind === "message").map((row) => row.message)).toEqual([reply]);
  });

  it("defaults to hidden and updates cached rows when toggled in either direction", () => {
    const input = {
      timelineEntries: deriveTimelineEntries([message], [], []),
      isWorking: true,
      activeTurnStartedAt: message.createdAt,
      latestTurn: {
        turnId,
        state: "running" as const,
        startedAt: message.createdAt,
        completedAt: null,
      },
      runningTurnId: turnId,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    };
    const hidden = deriveMessagesTimelineRowsWithState(input);
    const visible = deriveMessagesTimelineRowsWithState({ ...input, showThinking: true }, hidden);
    const hiddenAgain = deriveMessagesTimelineRowsWithState(
      { ...input, showThinking: false },
      visible,
    );
    expect(hidden.rows.some((row) => row.kind === "message")).toBe(false);
    expect(visible.rows.some((row) => row.kind === "message")).toBe(true);
    expect(hiddenAgain.rows).toEqual(hidden.rows);
  });

  it("shows the active phase without a duplicate Thinking placeholder", () => {
    const rows = rowsFor([message]);
    expect(rows.find((row) => row.kind === "message")).toMatchObject({
      reasoningActive: true,
      showAssistantMeta: false,
    });
    expect(rows.some((row) => row.kind === "thinking")).toBe(false);
  });
  it("retains completed and textless phases inside expanded work history", () => {
    const rows = rowsFor(
      [{ ...message, streaming: false, text: "" }],
      false,
      new Set(),
      true,
      new Set([turnId]),
    );
    expect(rows.find((row) => row.kind === "message")).toMatchObject({
      reasoningActive: false,
      reasoningExpanded: false,
      message: { role: "reasoning", text: "" },
    });
  });
  it("finishes the phase before turn end and retains manual expansion", () => {
    const rows = rowsFor([{ ...message, streaming: false }]);
    const row = rows.find((entry) => entry.kind === "message")!;
    expect(row).toMatchObject({ reasoningActive: false, reasoningExpanded: false });
    expect(
      rowsFor([{ ...message, streaming: false }], true, new Set([row.id])).find(
        (entry) => entry.id === row.id,
      ),
    ).toMatchObject({ reasoningExpanded: true });
  });
});
