import type { DesktopRuntimeArch } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

const SPY_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-spy\.(0|[1-9]\d*)$/;
const RELEASE_API = "https://api.github.com/repos/spysystem/t3code/releases/latest";
const RELEASE_TAG_URL = "https://github.com/spysystem/t3code/releases/tag/";

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

/** Windows and Linux x64 get published installers; Apple Silicon Macs rebuild each release. */
export function isSpyUpdatePlatform(
  platform: NodeJS.Platform,
  appArch: DesktopRuntimeArch,
): boolean {
  return platform === "darwin"
    ? appArch === "arm64"
    : (platform === "win32" || platform === "linux") && appArch === "x64";
}

/** How to apply an available SPY update; mirrored by the web update notification. */
export function spyUpdateInstructions(platform: NodeJS.Platform): string {
  return platform === "darwin"
    ? "Quit T3 Code, then rerun the SPY Mac build script with --install."
    : "Download the installer from GitHub, then close T3 Code and run it.";
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
  platform: NodeJS.Platform,
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
  // Macs rebuild the release tag from source (scripts/build-spy-desktop-mac.sh), so no asset is needed.
  const installerName =
    platform === "win32"
      ? `T3-Code-${version}-x64.exe`
      : platform === "linux"
        ? `T3-Code-${version}-x86_64.AppImage`
        : platform === "darwin"
          ? null
          : undefined;
  if (
    release.draft ||
    release.prerelease ||
    release.tag_name !== `spy-v${version}` ||
    !isSpyDesktopVersion(version) ||
    release.html_url !== `${RELEASE_TAG_URL}${release.tag_name}` ||
    (installerName !== null &&
      !release.assets.some((asset) => asset.name === installerName && asset.size > 0))
  ) {
    return yield* new SpyReleaseCheckError({
      message:
        "The latest GitHub release does not contain a published SPY installer for this platform.",
    });
  }
  return isNewerSpyVersion(version, currentVersion) ? { version, url: release.html_url } : null;
});
