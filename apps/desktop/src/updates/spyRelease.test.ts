import { assert, describe, it } from "@effect/vitest";
import { beforeEach, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

const fetchMock = vi.fn<typeof fetch>();

import { checkSpyRelease, isNewerSpyVersion } from "./spyRelease.ts";

function release(version = "0.0.41-spy.10") {
  return {
    tag_name: `spy-v${version}`,
    html_url: `https://github.com/spysystem/t3code/releases/tag/spy-v${version}`,
    draft: false,
    prerelease: false,
    assets: [{ name: `T3-Code-${version}-x64.exe`, size: 100 }],
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("SPY releases", () => {
  it.each([
    ["0.0.41-spy.10", "0.0.41-spy.9", true],
    ["0.0.42-spy.1", "0.0.41-spy.99", true],
    ["0.1.0-spy.1", "0.0.99-spy.99", true],
    ["1.0.0-spy.1", "0.99.99-spy.99", true],
    ["0.0.41-spy.10", "0.0.41-spy.10", false],
    ["0.0.41-spy.9", "0.0.41-spy.10", false],
    ["0.0.41-spy.99", "0.0.42-spy.1", false],
    ["0.0.42", "0.0.41-spy.1", false],
    ["0.0.42-nightly.1", "0.0.41-spy.1", false],
    ["0.0.42-spy.01", "0.0.41-spy.1", false],
    ["0.0.42-spy.1", "invalid", false],
  ])("compares %s against %s", (candidate, current, expected) => {
    assert.equal(isNewerSpyVersion(candidate, current), expected);
  });

  it.effect("returns the exact release URL for a newer installer", () => {
    fetchMock.mockResolvedValue(Response.json(release()));
    return Effect.gen(function* () {
      const update = yield* checkSpyRelease("0.0.41-spy.9");
      assert.deepEqual(update, { version: "0.0.41-spy.10", url: release().html_url });
      assert.equal(
        fetchMock.mock.calls[0]?.[0],
        "https://api.github.com/repos/spysystem/t3code/releases/latest",
      );
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchMock));
  });

  it.effect("does not offer a downgrade or reinstall", () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(release())));
    return Effect.gen(function* () {
      assert.equal(yield* checkSpyRelease("0.0.41-spy.10"), null);
      assert.equal(yield* checkSpyRelease("0.0.42-spy.1"), null);
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchMock));
  });

  it.effect("rejects drafts, upstream tags, missing installers, and malformed releases", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { ...release(), draft: true },
        { ...release(), prerelease: true },
        { ...release(), tag_name: "v0.0.42" },
        { ...release(), html_url: "https://github.com/pingdotgg/t3code/releases/tag/v0.0.42" },
        { ...release(), assets: [] },
        { ...release(), assets: [{ name: "source.zip", size: 100 }] },
        { ...release(), assets: [{ name: release().assets[0]?.name, size: 0 }] },
        { message: "Not found" },
      ]) {
        fetchMock.mockResolvedValue(Response.json(invalid));
        const error = yield* checkSpyRelease("0.0.41-spy.9").pipe(Effect.flip);
        assert.equal(error._tag, "SpyReleaseCheckError");
      }
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchMock)),
  );

  it.effect("reports rate limits as failed checks", () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    return Effect.gen(function* () {
      assert.equal(
        (yield* checkSpyRelease("0.0.41-spy.9").pipe(Effect.flip))._tag,
        "SpyReleaseCheckError",
      );
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchMock));
  });

  it.effect("reports offline failures as failed checks", () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    return Effect.gen(function* () {
      assert.equal(
        (yield* checkSpyRelease("0.0.41-spy.9").pipe(Effect.flip))._tag,
        "SpyReleaseCheckError",
      );
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchMock));
  });
});
