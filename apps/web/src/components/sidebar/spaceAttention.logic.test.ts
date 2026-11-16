import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  type OrchestrationV2ThreadSpace,
  orchestrationV2ThreadSpaceFields,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { resolveSpaceAttention } from "./spaceAttention.logic";

const environmentId = EnvironmentId.make("environment-local");

function supportThread(
  id: string,
  overrides: {
    visited?: boolean;
    settled?: boolean;
    space?: OrchestrationV2ThreadSpace;
    status?: "completed" | "failed";
  } = {},
) {
  return presentThreadShell(environmentId, {
    ...makeThreadFixture().source,
    id: ThreadId.make(id),
    ...orchestrationV2ThreadSpaceFields(overrides.space ?? "support"),
    latestRunId: RunId.make(`run-${id}`),
    status: overrides.status ?? "completed",
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
      delegatedUnderParent: new Set(),
      space: "support",
      localLastVisitedAtByKey: {},
      now: "2026-10-02T00:00:00.000Z",
    });
    expect(attention.count).toBe(1);
    expect(attention.status?.label).toBe("Completed");
  });

  it("counts failed runs but not unseen completions in Automation", () => {
    const automation = { space: "automation" } as const;
    const attention = resolveSpaceAttention({
      threads: [
        supportThread("finished", automation),
        supportThread("failed", { ...automation, status: "failed" }),
        supportThread("seen-failure", { ...automation, status: "failed", visited: true }),
      ],
      delegatedUnderParent: new Set(),
      space: "automation",
      localLastVisitedAtByKey: {},
      now: "2026-10-02T00:00:00.000Z",
    });
    expect(attention.count).toBe(1);
    expect(attention.status?.label).toBe("Failed");
  });
});
