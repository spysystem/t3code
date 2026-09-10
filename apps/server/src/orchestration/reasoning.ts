import { MessageId, type ProviderRuntimeEvent, type TurnId } from "@t3tools/contracts";

interface ReasoningPhase {
  readonly messageId: MessageId;
  readonly turnId: TurnId;
  readonly itemId?: string;
  readonly streamKind?: "reasoning_text" | "reasoning_summary_text";
  readonly summaryIndex?: number;
}

export interface ReasoningState {
  readonly active?: ReasoningPhase;
  readonly completedItemIds: ReadonlyArray<string>;
}

export interface ReasoningUpdate {
  readonly messageId: MessageId;
  readonly turnId: TurnId;
  readonly type: "delta" | "complete";
  readonly text: string;
}

/** Tracks provider-reported reasoning phases, independently of the busy indicator.
 * Providers without item boundaries end a phase when narration or a tool starts.
 * Only text deltas are persisted while streaming, not growing text snapshots. */
export function advanceReasoning(state: ReasoningState, event: ProviderRuntimeEvent) {
  let active = state.active;
  let completedItemIds = state.completedItemIds;
  const updates: ReasoningUpdate[] = [];
  if (
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    (event.payload.agentId || event.payload.parentToolUseId)
  ) {
    return { state, updates };
  }
  const complete = (text = "") => {
    if (!active) return;
    updates.push({ ...active, type: "complete", text });
    if (active.itemId) completedItemIds = [...completedItemIds, active.itemId].slice(-32);
    active = undefined;
  };
  const start = () => {
    if (!event.turnId) return;
    if (
      active &&
      (active.turnId !== event.turnId || (event.itemId && active.itemId !== event.itemId))
    ) {
      complete();
    }
    if (!active) {
      active = {
        messageId: MessageId.make(
          `reasoning:${event.threadId}:${event.turnId}:${event.itemId ?? event.eventId}`,
        ),
        turnId: event.turnId,
        ...(event.itemId ? { itemId: event.itemId } : {}),
      };
      updates.push({ ...active, type: "delta", text: "" });
    }
  };
  const reasoningItem =
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    event.payload.itemType === "reasoning";
  const reasoningDelta =
    event.type === "content.delta" &&
    (event.payload.streamKind === "reasoning_text" ||
      event.payload.streamKind === "reasoning_summary_text");

  if (
    (reasoningItem || reasoningDelta) &&
    event.itemId &&
    completedItemIds.includes(event.itemId)
  ) {
    return { state, updates };
  }
  if (
    event.type === "content.delta" &&
    (event.payload.streamKind === "reasoning_text" ||
      event.payload.streamKind === "reasoning_summary_text") &&
    event.payload.delta.length > 0
  ) {
    start();
    if (active && (!active.streamKind || active.streamKind === event.payload.streamKind)) {
      const summaryIndex = event.payload.summaryIndex;
      const separator =
        active.summaryIndex !== undefined &&
        summaryIndex !== undefined &&
        active.summaryIndex !== summaryIndex
          ? "\n\n"
          : "";
      active = {
        ...active,
        streamKind: event.payload.streamKind,
        ...(summaryIndex !== undefined ? { summaryIndex } : {}),
      };
      const text = separator + event.payload.delta;
      // The first delta can create the entry and append its text in one event.
      const opening = updates.at(-1);
      if (
        opening?.type === "delta" &&
        opening.messageId === active.messageId &&
        opening.text === ""
      ) {
        updates.pop();
      }
      updates.push({ ...active, type: "delta", text });
    }
  } else if (reasoningItem) {
    start();
    if (event.type === "item.completed") complete(event.payload.detail ?? "");
  } else if (
    (event.type === "content.delta" && event.payload.streamKind === "assistant_text") ||
    event.type === "item.started" ||
    ((event.type === "item.updated" || event.type === "item.completed") &&
      event.payload.itemType === "assistant_message") ||
    event.type === "turn.proposed.delta" ||
    event.type === "request.opened" ||
    event.type === "user-input.requested" ||
    event.type === "turn.completed" ||
    event.type === "turn.aborted" ||
    event.type === "session.exited" ||
    event.type === "turn.started" ||
    (event.type === "session.state.changed" && event.payload.state !== "running")
  ) {
    complete();
  }
  return {
    state: { ...(active ? { active } : {}), completedItemIds } satisfies ReasoningState,
    updates,
  };
}
