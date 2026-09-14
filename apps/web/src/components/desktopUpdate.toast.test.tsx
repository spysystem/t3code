import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DesktopUpdateState } from "@t3tools/contracts";

const testState = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock("./ui/toast", () => ({
  toastManager: { add: testState.addToast },
}));

import { showManualUpdateCheckResult } from "./desktopUpdate.toast";

function manualState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: "idle",
    channel: "latest",
    currentVersion: "0.0.29",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
    manual: true,
    ...overrides,
  };
}

describe("showManualUpdateCheckResult", () => {
  beforeEach(() => {
    testState.addToast.mockReset();
  });

  it("distinguishes a failed manual check from being up to date", () => {
    showManualUpdateCheckResult({
      checked: true,
      state: manualState({
        status: "error",
        errorContext: "check",
        message: "GitHub is unavailable.",
      }),
    });
    expect(testState.addToast).toHaveBeenLastCalledWith({
      type: "error",
      title: "Could not check for updates",
      description: "GitHub is unavailable.",
    });
    showManualUpdateCheckResult({
      checked: true,
      state: manualState({ status: "up-to-date" }),
    });
    expect(testState.addToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "success", title: "You're up to date" }),
    );
  });
});
