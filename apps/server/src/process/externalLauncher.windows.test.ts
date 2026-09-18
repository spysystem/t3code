// @effect-diagnostics nodeBuiltinImport:off - verifies the real Windows launcher and its child process lifecycle.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";

import * as ExternalLauncher from "./externalLauncher.ts";

// Quoting-only tests bypass the launcher's detached/stdio settings. Exercise the
// real launcher and PowerShell, replacing only Explorer with an argv recorder so
// this test never opens a desktop window.
// oxlint-disable-next-line t3code/no-global-process-runtime -- this integration test requires a real Windows host.
it.live.skipIf(process.platform !== "win32")(
  "reveals an untracked spreadsheet through the real Windows process chain",
  () =>
    Effect.gen(function* () {
      const tempRoot = NodePath.resolve(NodeOS.tmpdir());
      const directory = NodeFS.mkdtempSync(NodePath.join(tempRoot, "t3-reveal-"));
      const relativeDirectory = NodePath.relative(tempRoot, directory);
      expect(relativeDirectory.startsWith("t3-reveal-")).toBe(true);
      expect(relativeDirectory.includes(NodePath.sep)).toBe(false);
      const recorderPath = NodePath.join(directory, "recorder.cmd");
      const outputPath = NodePath.join(directory, "result.txt");
      const filePath = NodePath.join(directory, "Types (1).xlsx");
      NodeFS.writeFileSync(filePath, "File contents are irrelevant to revealing its path.");
      // Publish the result atomically so the watcher cannot read a partial write.
      NodeFS.writeFileSync(
        recorderPath,
        `@echo off\r\n>"${outputPath}.tmp" echo(%*\r\nmove /y "${outputPath}.tmp" "${outputPath}" >nul\r\n`,
      );
      const recorded = Promise.withResolvers<string>();
      const watcher = NodeFS.watch(directory, (_, filename) => {
        if (filename === "result.txt" && NodeFS.existsSync(outputPath)) {
          recorded.resolve(NodeFS.readFileSync(outputPath, "utf8").trim());
        }
      });
      watcher.on("error", recorded.reject);
      try {
        yield* Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const recordingSpawner = ChildProcessSpawner.make((command) => {
            if (!ChildProcess.isStandardCommand(command)) return spawner.spawn(command);
            const args = [...command.args];
            const encoded = args.at(-1);
            expect(encoded).toBeDefined();
            const source = Buffer.from(encoded ?? "", "base64").toString("utf16le");
            expect(source).toContain("Start-Process 'explorer.exe'");
            args[args.length - 1] = Buffer.from(
              source.replace(
                "'explorer.exe'",
                `'${recorderPath.replaceAll("'", "''")}' -WindowStyle Hidden`,
              ),
              "utf16le",
            ).toString("base64");
            return spawner.spawn(ChildProcess.make(command.command, args, command.options));
          });
          const launcher = yield* ExternalLauncher.make.pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, recordingSpawner),
          );
          yield* launcher.launchEditor({
            cwd: filePath.replaceAll("\\", "/"),
            editor: "file-manager",
            reveal: true,
          });
        });
        // Success waits on a filesystem event after launchEditor's scope closes.
        expect(
          yield* Effect.promise(() => recorded.promise).pipe(Effect.timeout("10 seconds")),
        ).toBe(`/select,"${filePath}"`);
      } finally {
        watcher.close();
        NodeFS.rmSync(directory, { recursive: true, force: true });
      }
    }).pipe(
      Effect.provide(
        Layer.merge(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv())),
      ),
    ),
  { timeout: 15_000 },
);
