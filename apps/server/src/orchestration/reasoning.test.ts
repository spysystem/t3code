import { describe, expect, it } from "vite-plus/test";
import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { advanceReasoning, type ReasoningState } from "./reasoning.ts";

const base = {
  eventId: EventId.make("event-1"),
  provider: ProviderDriverKind.make("codex"),
  threadId: ThreadId.make("thread-1"),
  turnId: TurnId.make("turn-1"),
  itemId: RuntimeItemId.make("thought-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
};
function tracker() {
  let state: ReasoningState = { completedItemIds: [] };
  return (event: ProviderRuntimeEvent) => {
    const next = advanceReasoning(state, event);
    state = next.state;
    return next.updates;
  };
}
const delta = (text: string): ProviderRuntimeEvent => ({
  ...base,
  type: "content.delta",
  payload: { streamKind: "reasoning_summary_text", delta: text },
});

describe("reasoning phases", () => {
  it("streams incremental text and uses the completed provider summary as authoritative", () => {
    const advance = tracker();
    const first = advance(delta("Compare "));
    expect(first).toMatchObject([{ type: "delta", text: "Compare " }]);
    expect(advance(delta("the approaches"))).toMatchObject([
      { messageId: first[0]!.messageId, type: "delta", text: "the approaches" },
    ]);
    const completed: ProviderRuntimeEvent = {
      ...base,
      type: "item.completed",
      payload: { itemType: "reasoning", detail: "Compared the approaches." },
    };
    expect(advance(completed)).toMatchObject([
      { messageId: first[0]!.messageId, type: "complete", text: "Compared the approaches." },
    ]);
    expect(advance(completed)).toEqual([]);
  });

  it("keeps summary sections separated without duplicating the alternate text stream", () => {
    const advance = tracker();
    expect(
      advance({
        ...base,
        type: "content.delta",
        payload: { streamKind: "reasoning_summary_text", summaryIndex: 0, delta: "First" },
      }),
    ).toMatchObject([{ text: "First" }]);
    expect(
      advance({
        ...base,
        type: "content.delta",
        payload: { streamKind: "reasoning_text", delta: "Alternate" },
      }),
    ).toEqual([]);
    expect(
      advance({
        ...base,
        type: "content.delta",
        payload: { streamKind: "reasoning_summary_text", summaryIndex: 1, delta: "Second" },
      }),
    ).toMatchObject([{ text: "\n\nSecond" }]);
  });

  it("preserves explicitly reported phases without text", () => {
    const advance = tracker();
    expect(
      advance({ ...base, type: "item.started", payload: { itemType: "reasoning" } }),
    ).toMatchObject([{ type: "delta", text: "" }]);
    expect(
      advance({ ...base, type: "item.completed", payload: { itemType: "reasoning" } }),
    ).toMatchObject([{ type: "complete", text: "" }]);
  });

  it("keeps reasoning open while an earlier tool reports progress", () => {
    const advance = tracker();
    advance(delta("Reviewing"));
    expect(
      advance({
        ...base,
        itemId: RuntimeItemId.make("tool-1"),
        type: "item.updated",
        payload: { itemType: "command_execution" },
      }),
    ).toEqual([]);
    expect(
      advance({
        ...base,
        itemId: RuntimeItemId.make("tool-1"),
        type: "item.completed",
        payload: { itemType: "command_execution" },
      }),
    ).toEqual([]);
    expect(advance(delta(" the output"))).toMatchObject([{ type: "delta", text: " the output" }]);
  });

  it("separates anonymous ACP phases around tool activity", () => {
    const advance = tracker();
    const { itemId: _itemId, ...anonymous } = base;
    const first = advance({
      ...anonymous,
      type: "content.delta",
      payload: { streamKind: "reasoning_text", delta: "Inspect files" },
    });
    expect(
      advance({ ...base, type: "item.started", payload: { itemType: "command_execution" } }),
    ).toMatchObject([{ type: "complete", messageId: first[0]!.messageId }]);
    const second = advance({
      ...anonymous,
      eventId: EventId.make("event-2"),
      type: "content.delta",
      payload: { streamKind: "reasoning_text", delta: "Review result" },
    });
    expect(second[0]!.messageId).not.toBe(first[0]!.messageId);
    expect(
      advance({
        ...base,
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: "Done" },
      }),
    ).toMatchObject([{ type: "complete", messageId: second[0]!.messageId }]);
  });

  it.each(["turn.aborted", "session.exited"] as const)("closes received text on %s", (type) => {
    const advance = tracker();
    advance(delta("Partial reasoning"));
    const event: ProviderRuntimeEvent =
      type === "turn.aborted"
        ? { ...base, type: "turn.aborted", payload: { reason: "interrupted" } }
        : { ...base, type: "session.exited", payload: {} };
    expect(advance(event)).toMatchObject([{ type: "complete", text: "" }]);
  });

  it("does not infer reasoning from an active turn or empty delta", () => {
    const advance = tracker();
    expect(advance({ ...base, type: "turn.started", payload: {} })).toEqual([]);
    expect(advance(delta(""))).toEqual([]);
    expect(advance({ ...base, type: "turn.completed", payload: { state: "completed" } })).toEqual(
      [],
    );
  });
});
