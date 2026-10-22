/**
 * Gated scheduled tasks (SPY fork): at each tick a check command decides
 * whether the task starts a turn at all, so a wait that outlasts a turn costs
 * a process instead of an LLM poll. This module runs the command and renders
 * its result into the prompt; `GateRun.ts` settles a tick.
 */
import {
  DEFAULT_SCHEDULED_TASK_GATE_TIMEOUT_MS,
  type ProjectId,
  type ScheduledTask,
  type ScheduledTaskGate,
  type ScheduledTaskUpsertSchedule,
  SCHEDULED_TASK_GATE_OUTPUT_LIMIT,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProjectService from "../project/ProjectService.ts";
import { frameUntrusted, noteUntrusted, type UntrustedSource } from "./webhookTemplate.ts";

/** In UTF-16 code units (string `length`), measured after decoding and trimming. */
export const GATE_OUTPUT_LIMIT = SCHEDULED_TASK_GATE_OUTPUT_LIMIT;
const GATE_ERROR_TAIL_CHARS = 2_000;
// Bytes kept while reading; the rest of a stream is drained and dropped.
// UTF-8 takes at most 3 bytes per UTF-16 unit (an emoji is 4 bytes for 2
// units), so output within GATE_OUTPUT_LIMIT is at most 60,000 bytes and
// this cap never cuts it.
const GATE_STDOUT_BYTES = GATE_OUTPUT_LIMIT * 4;
const GATE_STDERR_BYTES = GATE_ERROR_TAIL_CHARS * 4;
const TRUNCATED_MARKER = "\n[gate output truncated]";
const GATE_SOURCE: UntrustedSource = { name: "gate", origin: "the gate command's output" };

export type GateResult =
  | { readonly _tag: "news"; readonly output: string }
  | { readonly _tag: "quiet" }
  | { readonly _tag: "failed"; readonly error: string };

export interface GateCheck {
  readonly projectId: ProjectId;
  readonly gate: ScheduledTaskGate;
}

export class ScheduledTaskGateRunner extends Context.Reference<
  (check: GateCheck) => Effect.Effect<GateResult>
>("t3/scheduledTasks/ScheduledTaskGateRunner", {
  defaultValue: () => () =>
    Effect.succeed({ _tag: "failed", error: "This server cannot run gate commands." }),
}) {}

export function scheduleGate(schedule: ScheduledTask["schedule"]): ScheduledTaskGate | undefined {
  return schedule.type === "webhook" ? undefined : schedule.gate;
}

/**
 * A save that omits the gate keeps the stored one, so clients that predate
 * gates cannot drop it; null removes it.
 */
export function resolveTimerSchedule(
  schedule: Exclude<ScheduledTaskUpsertSchedule, { readonly type: "webhook" }>,
  stored: ScheduledTaskGate | undefined,
): Exclude<ScheduledTask["schedule"], { readonly type: "webhook" }> {
  const { gate, ...timer } = schedule;
  const kept = gate === undefined ? stored : (gate ?? undefined);
  return kept === undefined ? timer : { ...timer, gate: kept };
}

export function isSameGate(
  a: ScheduledTaskGate | null | undefined,
  b: ScheduledTaskGate | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return (
    a.command === b.command &&
    (a.timeoutMs ?? DEFAULT_SCHEDULED_TASK_GATE_TIMEOUT_MS) ===
      (b.timeoutMs ?? DEFAULT_SCHEDULED_TASK_GATE_TIMEOUT_MS)
  );
}

const placeholder = (name: "output" | "error") =>
  new RegExp(String.raw`\{\{\s*gate\.${name}\s*\}\}`, "g");

/**
 * Fills `{{gate.output}}` or `{{gate.error}}`, or appends the value after a
 * blank line when the prompt has no such placeholder; the other placeholder
 * renders empty. The value is framed as untrusted data like a webhook value:
 * the command may print text other people wrote.
 */
export function renderGatePrompt(
  prompt: string,
  value: { readonly output: string } | { readonly error: string },
  frameId: string,
): string {
  const [filled, text] =
    "output" in value ? (["output", value.output] as const) : (["error", value.error] as const);
  const framed = frameUntrusted(text, frameId, GATE_SOURCE);
  const cleared = prompt.replace(placeholder(filled === "output" ? "error" : "output"), "");
  const rendered =
    cleared.search(placeholder(filled)) === -1
      ? `${cleared.trimEnd()}\n\n${framed}`
      : cleared.replace(placeholder(filled), () => framed);
  return noteUntrusted(rendered, frameId, GATE_SOURCE);
}

function capOutput(stdout: string, cutByBytes: boolean): string {
  const output = stdout.trim();
  if (output === "" || (!cutByBytes && output.length <= GATE_OUTPUT_LIMIT)) return output;
  const kept = output.slice(0, GATE_OUTPUT_LIMIT - TRUNCATED_MARKER.length);
  // Drop a high surrogate the cut separated from its pair, so an emoji is not split.
  const last = kept.charCodeAt(kept.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept) + TRUNCATED_MARKER;
}

function boundedBuffer(limit: number, keep: "head" | "tail") {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let cut = false;
  return {
    push(chunk: Uint8Array) {
      if (keep === "head") {
        if (chunk.byteLength > limit - bytes) cut = true;
        if (bytes >= limit) return;
        chunks.push(chunk.subarray(0, limit - bytes));
        bytes += Math.min(chunk.byteLength, limit - bytes);
        return;
      }
      chunks.push(chunk);
      bytes += chunk.byteLength;
      while (chunks.length > 1 && bytes - chunks[0]!.byteLength >= limit) {
        bytes -= chunks.shift()!.byteLength;
      }
    },
    get cut() {
      return cut;
    },
    text() {
      const all = Buffer.concat(chunks, bytes);
      return new TextDecoder().decode(keep === "head" ? all : all.subarray(-limit));
    },
  };
}

function failure(summary: string, stderr: string): GateResult {
  const tail = stderr.trim().slice(-GATE_ERROR_TAIL_CHARS);
  return { _tag: "failed", error: tail === "" ? summary : `${summary}\n${tail}` };
}

/**
 * Runs the command through the platform shell (`cmd.exe` on Windows,
 * `/bin/sh` elsewhere) with the server's environment. A timeout closes the
 * scope, which kills the whole process tree.
 */
export const runGateCommand = Effect.fn("ScheduledTaskGate.runGateCommand")(function* (input: {
  readonly cwd: string;
  readonly command: string;
  readonly timeoutMs: number;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdout = boundedBuffer(GATE_STDOUT_BYTES, "head");
  const stderr = boundedBuffer(GATE_STDERR_BYTES, "tail");
  const exit = yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make(input.command, [], {
        cwd: input.cwd,
        // cmd.exe otherwise looks for a bare command name in the project
        // folder before PATH, where agents with lower access can add files.
        env: { NoDefaultCurrentDirectoryInExePath: "1" },
        extendEnv: true,
        shell: true,
        stdin: "ignore",
        forceKillAfter: "1 second",
      }),
    );
    yield* Effect.all(
      [
        Stream.runForEach(child.stdout, (chunk) => Effect.sync(() => stdout.push(chunk))),
        Stream.runForEach(child.stderr, (chunk) => Effect.sync(() => stderr.push(chunk))),
      ],
      { concurrency: "unbounded", discard: true },
    );
    return yield* child.exitCode;
  }).pipe(Effect.scoped, Effect.timeoutOption(Duration.millis(input.timeoutMs)), Effect.result);
  if (exit._tag === "Failure") {
    return failure(`Gate command could not run: ${exit.failure.message}`, stderr.text());
  }
  if (Option.isNone(exit.success)) {
    return failure(`Gate command timed out after ${input.timeoutMs} ms.`, stderr.text());
  }
  const code = Number(exit.success.value);
  if (code !== 0) return failure(`Gate command exited with code ${code}.`, stderr.text());
  const output = capOutput(stdout.text(), stdout.cut);
  return output === "" ? ({ _tag: "quiet" } as const) : ({ _tag: "news", output } as const);
});

export const layer = Layer.effect(
  ScheduledTaskGateRunner,
  Effect.gen(function* () {
    const projects = yield* ProjectService.ProjectService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return (check: GateCheck) =>
      projects.getById(check.projectId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.succeed<GateResult>({
                _tag: "failed",
                error: `Project ${check.projectId} was not found.`,
              }),
            onSome: (project) =>
              runGateCommand({
                cwd: project.workspaceRoot,
                command: check.gate.command,
                timeoutMs: check.gate.timeoutMs ?? DEFAULT_SCHEDULED_TASK_GATE_TIMEOUT_MS,
              }),
          }),
        ),
        Effect.catch((error) =>
          Effect.succeed<GateResult>({
            _tag: "failed",
            error: `Could not load project ${check.projectId}: ${error.message}`,
          }),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
  }),
);
