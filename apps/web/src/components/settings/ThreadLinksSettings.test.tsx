import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { getThreadLink, resolveThreadLinkRules } from "@t3tools/client-runtime/thread-links";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ResolvedSettingsScope } from "./settingsScope";
import { resolveSettingsScope } from "./settingsScope";
import {
  resolveScopedSettingsTargets,
  scopedSettingsAreMixed,
  selectScopedSettingsEnvironments,
} from "./scopedSettings";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";

const state = vi.hoisted(() => {
  const environments: Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: "connected" | "offline" };
    serverConfig: {
      settings: ServerSettings;
      environment: {
        capabilities: { projectSettingsOverrides: boolean; threadLinkProjectSettings: boolean };
      };
    };
  }> = [];
  const initialScope = (): ResolvedSettingsScope => ({
    kind: "all",
    label: "All environments",
    members: [],
    environmentIds: [],
  });
  return { environments, scope: initialScope(), updateSettings: vi.fn(), toast: vi.fn() };
});
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: state.scope,
    targets: resolveScopedSettingsTargets(state.scope, state.environments),
    ...selectScopedSettingsEnvironments(state.scope, state.environments, null),
  }),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: (select: (settings: ServerSettings) => unknown) =>
    select(
      resolveScopedSettingsTargets(state.scope, state.environments)[0]?.settings ??
        DEFAULT_SERVER_SETTINGS,
    ),
  useScopedSettingsMixed: (keys: readonly (keyof ServerSettings)[]) =>
    scopedSettingsAreMixed(resolveScopedSettingsTargets(state.scope, state.environments), keys),
}));
vi.mock("../../hooks/useSettings", () => ({ persistClientSettingsPatch: vi.fn() }));
vi.mock("../../state/server", () => ({ serverEnvironment: { updateSettings: Symbol("update") } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.updateSettings }));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("../ui/button", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({ Input: (props: ComponentProps<"input">) => <input {...props} /> }));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingsRow: ({
    title,
    description,
    control,
  }: {
    title: string;
    description: string;
    control: ReactNode;
  }) => (
    <div>
      {title}
      {description}
      {control}
    </div>
  ),
}));

import { ScopedThreadLinksSettings } from "./ThreadLinksSettings";

let renderer: ReactTestRenderer;
const first = EnvironmentId.make("first");
const second = EnvironmentId.make("second");
const projectId = ProjectId.make("project");
const anotherProject = ProjectId.make("another");
const issue = { name: "Issue", pattern: "#(\\d+)", urlTemplate: "https://tracker.example/{1}" };
const member = {
  id: projectId,
  environmentId: first,
  title: "Project",
  workspaceRoot: "/repo",
  physicalProjectKey: "first:/repo",
  environmentLabel: "First",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-13T00:00:00Z",
  updatedAt: "2026-09-13T00:00:00Z",
};
const secondMember = {
  ...member,
  environmentId: second,
  physicalProjectKey: "second:/repo",
  environmentLabel: "Second",
};
const group: SidebarProjectSnapshot = {
  ...member,
  projectKey: "group",
  displayName: "Project",
  memberProjects: [member, secondMember],
  memberProjectRefs: [first, second].map((environmentId) => ({ environmentId, projectId })),
  groupedProjectCount: 2,
  environmentPresence: "remote-only",
  allRemoteMembersAreDesktopLocal: false,
  allRemoteMembersAreWsl: false,
  remoteEnvironmentLabels: ["First", "Second"],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.environments = [first, second].map((environmentId) => ({
    environmentId,
    label: environmentId,
    connection: { phase: "connected" },
    serverConfig: {
      settings: { ...DEFAULT_SERVER_SETTINGS, defaultThreadLinkRules: [issue] },
      environment: {
        capabilities: { projectSettingsOverrides: true, threadLinkProjectSettings: true },
      },
    },
  }));
  state.scope = resolveSettingsScope({}, [group], state.environments);
  state.updateSettings
    .mockReset()
    .mockImplementation(
      async ({
        environmentId,
        input,
      }: {
        environmentId: EnvironmentId;
        input: { patch: ServerSettingsPatch };
      }) => {
        const environment = state.environments.find(
          (entry) => entry.environmentId === environmentId,
        )!;
        environment.serverConfig.settings = applyServerSettingsPatch(
          environment.serverConfig.settings,
          input.patch,
        );
        return { _tag: "Success" };
      },
    );
  state.toast.mockClear();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function render() {
  await act(() => {
    renderer = create(<ScopedThreadLinksSettings />);
  });
}
async function click(text: string) {
  const button = renderer.root.findAllByType("button").find((node) => node.children.includes(text));
  expect(button).toBeDefined();
  await act(() => button?.props.onClick());
}
async function change(label: string, value: string) {
  const input = renderer.root
    .findAllByType("label")
    .find((node) => node.findAllByType("span").some((span) => span.children.includes(label)))!
    .findByType("input");
  await act(() => input.props.onChange({ target: { value } }));
}
async function submit() {
  await act(() => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
}
const settings = (id: EnvironmentId) =>
  state.environments.find((entry) => entry.environmentId === id)!.serverConfig.settings;
const link = (id: EnvironmentId, project = projectId) =>
  getThreadLink("Fix #42", resolveThreadLinkRules(settings(id), project))?.url;

describe("scoped thread link editor", () => {
  it("validates and previews a draft before saving through the environment scope", async () => {
    state.scope = resolveSettingsScope({ machine: first }, [group], state.environments);
    await render();
    await click("Configure links");
    await change("Link template", "https://new.example/{2}");
    await submit();
    expect(state.updateSettings).not.toHaveBeenCalled();
    await change("Link template", "https://new.example/{1}");
    await change("Sample thread title", "Fix #42");
    expect(renderer.root.findByType("a").props.href).toBe("https://new.example/42");
    await submit();
    expect(link(first)).toBe("https://new.example/42");
    expect(link(second)).toBe("https://tracker.example/42");
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
  });

  it("saves all environment defaults while preserving existing project overrides", async () => {
    state.environments[0]!.serverConfig.settings = applyServerSettingsPatch(settings(first), {
      projectSettingsOverrides: { [projectId]: { defaultThreadLinkRules: [] } },
    });
    await render();
    await click("Configure links");
    await change("Link template", "https://new.example/{1}");
    await submit();
    expect(link(first)).toBeUndefined();
    expect(link(first, anotherProject)).toBe("https://new.example/42");
    expect(link(second)).toBe("https://new.example/42");
  });

  it("creates project overrides across environments without changing defaults or other projects", async () => {
    state.scope = resolveSettingsScope({ project: group.projectKey }, [group], state.environments);
    await render();
    await click("Configure links");
    await click("Remove");
    await submit();
    for (const id of [first, second]) {
      expect(link(id)).toBeUndefined();
      expect(link(id, anotherProject)).toBe("https://tracker.example/42");
      expect(settings(id).projectSettingsOverrides[projectId]?.defaultThreadLinkRules).toEqual([]);
      expect(settings(id).projectThreadLinkOverrides[projectId]).toEqual([]);
    }
  });

  it("discards an unsaved draft when the selected environment changes", async () => {
    state.scope = resolveSettingsScope({ machine: first }, [group], state.environments);
    await render();
    await click("Configure links");
    await change("Name", "Unsaved draft");
    state.scope = resolveSettingsScope({ machine: second }, [group], state.environments);
    await act(() => renderer.update(<ScopedThreadLinksSettings />));
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
    await click("Configure links");
    await submit();
    expect(settings(second).defaultThreadLinkRules).toEqual([issue]);
  });

  it("retains the draft after a partial failure and still saves later environments", async () => {
    state.updateSettings.mockResolvedValueOnce({ _tag: "Failure" });
    await render();
    await click("Configure links");
    await change("Link template", "https://new.example/{1}");
    await submit();
    expect(link(first)).toBe("https://tracker.example/42");
    expect(link(second)).toBe("https://new.example/42");
    expect(renderer.root.findAllByType("form")).toHaveLength(1);
    expect(state.toast).toHaveBeenCalled();
    await submit();
    expect(link(first)).toBe("https://new.example/42");
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
  });

  it("skips offline environments and blocks older servers that cannot save this scoped key", async () => {
    state.environments[1]!.connection.phase = "offline";
    await render();
    await click("Configure links");
    await click("Remove");
    await submit();
    expect(link(first)).toBeUndefined();
    expect(link(second)).toBe("https://tracker.example/42");
    state.environments[1]!.connection.phase = "connected";
    state.environments[1]!.serverConfig.environment.capabilities.threadLinkProjectSettings = false;
    await act(() => renderer.update(<ScopedThreadLinksSettings />));
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
    expect(renderer.root.findByType("p").children.join("")).toContain("Update second");
  });
});
