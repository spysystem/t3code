import { describe, expect, it } from "vite-plus/test";
import { TurnId } from "@t3tools/contracts";
import { reasoningPresentation } from "./reasoning.ts";

const turnId = TurnId.make("turn-1");
const message = { text: "Compare the two approaches.", turnId, streaming: true };

describe("reasoning disclosure", () => {
  it("keeps late-arriving summaries visible when text and completion reach the same render", () => {
    // Captured Codex phases supplied text only 9–38 ms before completion.
    // A client can render the empty phase and then the completed snapshot.
    expect(reasoningPresentation({ ...message, text: "" }, turnId)).toMatchObject({
      expanded: true,
      hasText: false,
    });
    expect(reasoningPresentation({ ...message, streaming: false }, turnId)).toMatchObject({
      expanded: false,
      preview: "Compare the two approaches.",
    });
  });

  it("opens while the phase streams, then collapses even when the turn continues", () => {
    expect(reasoningPresentation(message, turnId)).toMatchObject({
      active: true,
      expanded: true,
      label: "Thinking…",
    });
    expect(reasoningPresentation({ ...message, streaming: false }, turnId)).toMatchObject({
      active: false,
      expanded: false,
      label: "Thought",
    });
  });
  it("lets completed reasoning stay manually expanded", () => {
    expect(reasoningPresentation({ ...message, streaming: false }, null, true)).toMatchObject({
      expanded: true,
      preview: "",
    });
  });
  it("previews a Markdown heading without rendering the full reasoning body", () => {
    expect(
      reasoningPresentation(
        {
          ...message,
          streaming: false,
          text: "\n## **Compare approaches**\n\nLonger explanation.",
        },
        null,
      ).preview,
    ).toBe("Compare approaches");
    expect(
      reasoningPresentation({ ...message, streaming: false, text: "x".repeat(200) }, null).preview,
    ).toBe("x".repeat(160) + "…");
  });
  it("collapses stale streaming entries after interruption, reconnect, or a new turn", () => {
    expect(reasoningPresentation(message, null).expanded).toBe(false);
    expect(reasoningPresentation(message, TurnId.make("turn-2")).expanded).toBe(false);
  });
  it("labels an explicit phase without readable text", () => {
    expect(reasoningPresentation({ ...message, text: "" }, turnId)).toMatchObject({
      active: true,
      hasText: false,
    });
    expect(reasoningPresentation({ ...message, text: "", streaming: false }, null)).toMatchObject({
      expanded: false,
      label: "Thought · No summary provided",
    });
  });
});
