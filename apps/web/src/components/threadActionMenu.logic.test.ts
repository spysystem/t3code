import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  space: "development",
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
    spaces: false,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

function allIds(state: ThreadActionMenuState): string[] {
  const flatten = (items: ReturnType<typeof buildThreadActionMenuItems>): string[] =>
    items.flatMap((item) => [item.id, ...(item.children ? flatten(item.children) : [])]);
  return flatten(buildThreadActionMenuItems(state));
}

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("offers native ID copying only when the server supports it, retaining T3 ID copying", () => {
    expect(allIds(baseState)).not.toContain("copy-native-thread-id");
    const supported = allIds({
      ...baseState,
      supports: { ...baseState.supports, nativeThreadId: true },
    });
    expect(supported).toContain("copy-thread-id");
    expect(supported).toContain("copy-native-thread-id");
  });

  it("offers the move to the other space only where the server supports spaces", () => {
    const label = (space: "development" | "support") =>
      buildThreadActionMenuItems({
        ...baseState,
        space,
        supports: { ...baseState.supports, spaces: true },
      }).find((item) => item.id === "move-space")?.label;
    expect(label("development")).toBe("Move to Dev support");
    expect(label("support")).toBe("Move to Development");
    expect(ids(baseState)).not.toContain("move-space");
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});
