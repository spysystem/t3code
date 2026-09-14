import type { DesktopUpdateState } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  state: null as DesktopUpdateState | null,
  add: vi.fn<
    (toast: {
      title: string;
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

let renderer: ReactTestRenderer | undefined;
const openExternal = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  mocks.state = null;
  mocks.add.mockReset().mockReturnValue("spy-update");
  mocks.close.mockReset();
  openExternal.mockClear();
  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { localStorage: storage, desktopBridge: { openExternal } }),
  );
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("SPY update notification", () => {
  it("persists dismissal across remounts, stays quiet during polling, and announces a new version", async () => {
    mocks.state = available("0.0.41-spy.2");
    await act(async () => {
      renderer = create(<SpyUpdateNotification />);
    });
    expect(mocks.add).toHaveBeenCalledTimes(1);

    mocks.state = { ...mocks.state, status: "checking" };
    await act(async () => {
      renderer?.update(<SpyUpdateNotification />);
    });
    mocks.state = available("0.0.41-spy.2");
    await act(async () => {
      renderer?.update(<SpyUpdateNotification />);
    });
    expect(mocks.add).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.add.mock.calls[0]?.[0].actionProps?.onClick?.();
    });
    expect(openExternal).toHaveBeenCalledWith(mocks.state.releaseUrl);
    await act(async () => {
      mocks.add.mock.calls[0]?.[0].data?.onClose?.();
    });
    await act(async () => {
      renderer?.unmount();
    });
    await act(async () => {
      renderer = create(<SpyUpdateNotification />);
    });
    expect(mocks.add).toHaveBeenCalledTimes(1);

    mocks.state = available("0.0.41-spy.3");
    await act(async () => {
      renderer?.update(<SpyUpdateNotification />);
    });
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add.mock.calls[1]?.[0].title).toContain("0.0.41-spy.3");
  });

  it("does not notify for failed background checks or upstream updates", async () => {
    mocks.state = { ...available("0.0.41-spy.2"), status: "error", availableVersion: null };
    await act(async () => {
      renderer = create(<SpyUpdateNotification />);
    });
    expect(mocks.add).not.toHaveBeenCalled();
    mocks.state = { ...available("0.0.41-spy.2"), manual: false };
    await act(async () => {
      renderer?.update(<SpyUpdateNotification />);
    });
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
