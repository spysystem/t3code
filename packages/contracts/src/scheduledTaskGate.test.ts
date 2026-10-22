import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { OrchestratorMcpScheduleTaskInput } from "./orchestratorMcp.ts";
import { ScheduledTaskSchedule, ScheduledTaskUpsertSchedule } from "./scheduledTask.ts";

const decodeUpsertSchedule = Schema.decodeUnknownSync(ScheduledTaskUpsertSchedule);
const decodeSchedule = Schema.decodeUnknownSync(ScheduledTaskSchedule);
const decodeMcpInput = Schema.decodeUnknownSync(OrchestratorMcpScheduleTaskInput);
const gate = { command: "node mentions.mjs", timeoutMs: 30_000 };

describe("scheduled task gates", () => {
  it("are accepted on interval and fixed-time schedules", () => {
    expect(decodeUpsertSchedule({ type: "interval", everyMs: 600_000, gate })).toEqual({
      type: "interval",
      everyMs: 600_000,
      gate,
    });
    expect(decodeUpsertSchedule({ type: "fixed_time", timeOfDay: "09:00", gate: null })).toEqual({
      type: "fixed_time",
      timeOfDay: "09:00",
      gate: null,
    });
    expect(decodeSchedule({ type: "fixed_time", timeOfDay: "09:00", gate })).toEqual({
      type: "fixed_time",
      timeOfDay: "09:00",
      gate,
    });
  });

  it("are rejected on webhook schedules", () => {
    expect(() => decodeUpsertSchedule({ type: "webhook", gate })).toThrow();
    expect(() =>
      decodeMcpInput({ prompt: "Handle the request.", schedule: { type: "webhook", gate } }),
    ).toThrow();
    expect(decodeUpsertSchedule({ type: "webhook" })).toEqual({ type: "webhook" });
  });

  it("limit the timeout to five minutes", () => {
    expect(() =>
      decodeUpsertSchedule({
        type: "interval",
        everyMs: 600_000,
        gate: { command: "true", timeoutMs: 300_001 },
      }),
    ).toThrow();
    expect(() =>
      decodeUpsertSchedule({ type: "interval", everyMs: 600_000, gate: { command: " " } }),
    ).toThrow();
  });
});
