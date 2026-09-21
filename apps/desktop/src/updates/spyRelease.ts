import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

const SPY_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-spy\.(0|[1-9]\d*)$/;
const RELEASE_API = "https://api.github.com/repos/spysystem/t3code/releases/latest";
const RELEASE_TAG_URL = "https://github.com/spysystem/t3code/releases/tag/";

/**
 * Release artifacts the fork publishes per platform. Windows ships the NSIS
 * installer; Linux ships the AppImage that `t3-spy-install` extracts. Both are
 * x64 only, so the arch check stays separate from this table.
 */
const SPY_RELEASE_ASSETS = {
  win32: { suffix: "-x64.exe", label: "Windows x64 installer" },
  linux: { suffix: "-x86_64.AppImage", label: "Linux x86_64 AppImage" },
} as const satisfies Partial<Record<NodeJS.Platform, { suffix: string; label: string }>>;

export type SpyUpdatePlatform = keyof typeof SPY_RELEASE_ASSETS;

/** Platforms the fork publishes desktop artifacts for. */
export function isSpyUpdatePlatform(platform: NodeJS.Platform): platform is SpyUpdatePlatform {
  return platform in SPY_RELEASE_ASSETS;
}

function spyReleaseAssetName(platform: SpyUpdatePlatform, version: string): string {
  return `T3-Code-${version}${SPY_RELEASE_ASSETS[platform].suffix}`;
}

const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  html_url: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  assets: Schema.Array(Schema.Struct({ name: Schema.String, size: Schema.Finite })),
});

export function isSpyDesktopVersion(version: string): boolean {
  return SPY_VERSION.test(version);
}

/** Compare every numeric part, including the fork build number (spy.10 > spy.9). */
export function isNewerSpyVersion(candidate: string, current: string): boolean {
  const next = SPY_VERSION.exec(candidate)?.slice(1).map(BigInt);
  const installed = SPY_VERSION.exec(current)?.slice(1).map(BigInt);
  if (!next || !installed) return false;
  for (const [index, part] of next.entries()) {
    const previous = installed[index];
    if (previous !== undefined && part !== previous) return part > previous;
  }
  return false;
}

export class SpyReleaseCheckError extends Schema.TaggedError<SpyReleaseCheckError>()(
  "SpyReleaseCheckError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export const checkSpyRelease = Effect.fn("desktop.updates.checkSpyRelease")(function* (
  currentVersion: string,
  platform: SpyUpdatePlatform,
) {
  const release = yield* Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    return yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response);
  }).pipe(
    Effect.timeout("15 seconds"),
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(
      (cause) =>
        new SpyReleaseCheckError({
          message: "Could not check GitHub for SPY updates. Please try again later.",
          cause,
        }),
    ),
  );
  const version = release.tag_name.replace(/^spy-v/, "");
  if (
    release.draft ||
    release.prerelease ||
    release.tag_name !== `spy-v${version}` ||
    !isSpyDesktopVersion(version) ||
    release.html_url !== `${RELEASE_TAG_URL}${release.tag_name}` ||
    !release.assets.some(
      (asset) => asset.name === spyReleaseAssetName(platform, version) && asset.size > 0,
    )
  ) {
    return yield* new SpyReleaseCheckError({
      message: `The latest GitHub release is not a published SPY ${SPY_RELEASE_ASSETS[platform].label}.`,
    });
  }
  return isNewerSpyVersion(version, currentVersion) ? { version, url: release.html_url } : null;
});
