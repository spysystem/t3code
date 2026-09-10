import type { OrchestrationMessage, TurnId } from "@t3tools/contracts";

/** Expansion follows the reasoning phase, not the lifetime of the whole turn.
 * Manual expansion only applies to history; stale streaming flags after a
 * disconnected session must not reopen old reasoning. */
export function reasoningPresentation(
  message: Pick<OrchestrationMessage, "text" | "streaming" | "turnId">,
  activeTurnId: TurnId | null,
  manuallyExpanded = false,
) {
  const active = message.streaming && activeTurnId !== null && message.turnId === activeTurnId;
  const text = message.text.trim();
  const hasText = text.length > 0;
  const expanded = active || (hasText && manuallyExpanded);
  // Some providers deliver the summary immediately before completing the phase.
  // Keep a bounded preview readable even if the client never paints the live text.
  const firstLine =
    !expanded && hasText
      ? text
          .split("\n", 1)[0]!
          .trim()
          .replace(/^#{1,6}\s+/, "")
          .replace(/^\*\*(.+)\*\*$/, "$1")
      : "";
  return {
    active,
    hasText,
    expanded,
    preview: firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine,
    label: active ? "Thinking…" : hasText ? "Thought" : "Thought · No summary provided",
  };
}
