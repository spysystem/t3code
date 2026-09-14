import { assert, describe, it } from "@effect/vitest";
import { beforeEach, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

const fetchMock = vi.fn<typeof fetch>();
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

const spyOptions = {
  appVersion: "0.0.41-spy.9",
  platform: "win32",
  env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
} as const;
const releaseUrl = "https://github.com/spysystem/t3code/releases/tag/spy-v0.0.41-spy.10";
function stubRelease() {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        tag_name: "spy-v0.0.41-spy.10",
        html_url: releaseUrl,
        draft: false,
        prerelease: false,
        assets: [{ name: "T3-Code-0.0.41-spy.10-x64.exe", size: 100 }],
      }),
    ),
  );
  return fetchMock;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("SPY desktop manual updates", () => {
  it.effect(
    "checks without an updater feed and refuses automated download, install, and channel changes",
    () => {
      stubRelease();
      const harness = makeHarness(spyOptions);
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;
          assert.equal(Option.isNone(yield* updates.disabledReason), true);
          const result = yield* updates.check("menu");
          assert.equal(result.checked, true);
          assert.equal(result.state.status, "available");
          assert.equal(result.state.manual, true);
          assert.equal(result.state.availableVersion, "0.0.41-spy.10");
          assert.equal(result.state.releaseUrl, releaseUrl);
          assert.equal((yield* updates.download).accepted, false);
          assert.equal((yield* updates.install).accepted, false);
          assert.equal((yield* updates.installPrepared("0.0.41-spy.10")).accepted, false);
          assert.equal((yield* updates.setChannel("nightly")).channel, "latest");
          assert.equal(harness.checkCount(), 0);
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
          assert.equal(harness.listenerCount(), 0);
          assert.deepEqual(harness.feedUrls(), []);
        }),
      ).pipe(
        Effect.provide(harness.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetchMock),
      );
    },
  );

  it.effect("checks on startup and polls every four hours", () => {
    const fetchMock = stubRelease();
    const harness = makeHarness(spyOptions);
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const { changes } = yield* updates.subscribe;
        const available = Stream.filter(changes, (state) => state.status === "available");
        const startup = yield* Stream.runHead(available).pipe(Effect.forkChild);
        yield* TestClock.adjust("15 seconds");
        yield* Fiber.join(startup);
        assert.equal(fetchMock.mock.calls.length, 1);
        yield* TestClock.adjust("4 minutes");
        assert.equal(fetchMock.mock.calls.length, 1);
        const poll = yield* Stream.runHead(available).pipe(Effect.forkChild);
        yield* TestClock.adjust("4 hours");
        yield* Fiber.join(poll);
        assert.equal(fetchMock.mock.calls.length, 2);
      }),
    ).pipe(
      Effect.provide(Layer.merge(TestClock.layer(), harness.layer)),
      Effect.provideService(FetchHttpClient.Fetch, fetchMock),
    );
  });

  it.effect("reports failed checks and recovers on retry", () => {
    const fetchMock = stubRelease();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const harness = makeHarness(spyOptions);
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const failed = yield* updates.check("menu");
        assert.equal(failed.state.status, "error");
        assert.equal(failed.state.errorContext, "check");
        assert.equal((yield* updates.check("menu")).state.status, "available");
      }),
    ).pipe(Effect.provide(harness.layer), Effect.provideService(FetchHttpClient.Fetch, fetchMock));
  });

  it.effect("does not check in development, on unsupported platforms, or when disabled", () =>
    Effect.gen(function* () {
      const fetchMock = stubRelease();
      for (const options of [
        { ...spyOptions, isPackaged: false },
        { ...spyOptions, platform: "darwin" as const },
        { ...spyOptions, env: { T3CODE_DISABLE_AUTO_UPDATE: "true" } },
      ]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const updates = yield* DesktopUpdates.DesktopUpdates;
            yield* updates.configure;
            assert.equal((yield* updates.check("menu")).checked, false);
            assert.equal((yield* updates.getState).status, "disabled");
          }),
        ).pipe(Effect.provide(makeHarness(options).layer));
      }
      assert.equal(fetchMock.mock.calls.length, 0);
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchMock)),
  );
});
