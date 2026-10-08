import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { resolveSpaceAttention } from "./spaceAttention.logic";

const environmentId = EnvironmentId.make("environment-local");

function supportThread(
  id: string,
  overrides: { visited?: boolean; settled?: boolean; space?: "development" | "support" } = {},
) {
  return presentThreadShell(environmentId, {
    ...makeThreadFixture().source,
    id: ThreadId.make(id),
    space: overrides.space ?? "support",
    latestRunId: RunId.make(`run-${id}`),
    status: "completed",
    latestRunCompletedAt: DateTime.makeUnsafe("2026-10-01T10:00:00.000Z"),
    lastVisitedAt: DateTime.makeUnsafe(
      overrides.visited ? "2026-10-01T11:00:00.000Z" : "2026-10-01T09:00:00.000Z",
    ),
    ...(overrides.settled
      ? { settledOverride: "settled", settledAt: DateTime.makeUnsafe("2026-10-01T12:00:00.000Z") }
      : {}),
  });
}

describe("resolveSpaceAttention", () => {
  it("counts unseen completions in the space and ignores seen, parked, and other-space threads", () => {
    const attention = resolveSpaceAttention({
      threads: [
        supportThread("unseen"),
        supportThread("seen", { visited: true }),
        supportThread("settled", { settled: true }),
        supportThread("development", { space: "development" }),
      ],
      space: "support",
      localLastVisitedAtByKey: {},
      now: "2026-10-02T00:00:00.000Z",
    });
    expect(attention.count).toBe(1);
    expect(attention.status?.label).toBe("Completed");
  });
});
