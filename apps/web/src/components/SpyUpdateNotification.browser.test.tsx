import type { DesktopUpdateState } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  state: null as DesktopUpdateState | null,
  add: vi.fn<
    (toast: {
      title: string;
      description?: string;
      actionProps?: { onClick?: () => void };
      data?: { onClose?: () => void };
    }) => string
  >(),
  close: vi.fn(),
}));
vi.mock("../state/desktopUpdate", () => ({ useDesktopUpdateState: () => mocks.state }));
vi.mock("./ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: mocks.add, close: mocks.close },
}));

import { SpyUpdateNotification } from "./SpyUpdateNotification";

function available(version: string): DesktopUpdateState {
  return {
    manual: true,
    enabled: true,
    status: "available",
    channel: "latest",
    currentVersion: "0.0.41-spy.1",
    hostArch: "x64",
    appArch: "x64",
    runningUnderArm64Translation: false,
    availableVersion: version,
    releaseUrl: `https://github.com/spysystem/t3code/releases/tag/spy-v${version}`,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

let root: Root | undefined;
let container: HTMLDivElement;
const openExternal = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  mocks.state = null;
  mocks.add.mockReset().mockReturnValue("spy-update");
  mocks.close.mockReset();
  openExternal.mockClear();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("desktopBridge", { openExternal });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const mount = () =>
  act(async () => {
    root = createRoot(container);
    root.render(<SpyUpdateNotification />);
  });
const rerender = () => act(async () => root?.render(<SpyUpdateNotification />));

describe("SPY update notification", () => {
  it("persists dismissal across remounts, stays quiet during polling, and announces a new version", async () => {
    mocks.state = available("0.0.41-spy.2");
    await mount();
    expect(mocks.add).toHaveBeenCalledTimes(1);

    mocks.state = { ...mocks.state, status: "checking" };
    await rerender();
    mocks.state = available("0.0.41-spy.2");
    await rerender();
    expect(mocks.add).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.add.mock.calls[0]?.[0].actionProps?.onClick?.();
    });
    expect(openExternal).toHaveBeenCalledWith(mocks.state.releaseUrl);
    await act(async () => {
      mocks.add.mock.calls[0]?.[0].data?.onClose?.();
    });
    await act(async () => root?.unmount());
    await mount();
    expect(mocks.add).toHaveBeenCalledTimes(1);

    mocks.state = available("0.0.41-spy.3");
    await rerender();
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add.mock.calls[1]?.[0].title).toContain("0.0.41-spy.3");
  });

  it("shows the package-manager update for .deb and .rpm installs", async () => {
    const updateInstructions =
      "Run sudo apt update && sudo apt install --only-upgrade t3code, then restart T3 Code.";
    mocks.state = available("0.0.41-spy.2");
    await mount();
    expect(mocks.add.mock.calls[0]?.[0].description).not.toBe(updateInstructions);
    mocks.state = { ...available("0.0.41-spy.3"), updateInstructions };
    await rerender();
    expect(mocks.add.mock.calls[1]?.[0].description).toBe(updateInstructions);
  });

  it("does not notify for failed background checks or upstream updates", async () => {
    mocks.state = { ...available("0.0.41-spy.2"), status: "error", availableVersion: null };
    await mount();
    expect(mocks.add).not.toHaveBeenCalled();
    mocks.state = { ...available("0.0.41-spy.2"), manual: false };
    await rerender();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
