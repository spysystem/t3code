import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ServerSettings,
} from "@t3tools/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => {
  const environments: Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: string };
    serverConfig: { settings: ServerSettings };
  }> = [];
  return { environments, updateSettings: vi.fn(), toast: vi.fn() };
});
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: state.environments }),
}));
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

import { ThreadLinksSettings } from "./ThreadLinksSettings";

let renderer: ReactTestRenderer;
const first = EnvironmentId.make("first");
const second = EnvironmentId.make("second");
const projectId = ProjectId.make("project");
const issue = { name: "Issue", pattern: "#(\\d+)", urlTemplate: "https://tracker.example/{1}" };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.environments = [
    {
      environmentId: first,
      label: "First",
      connection: { phase: "connected" },
      serverConfig: { settings: DEFAULT_SERVER_SETTINGS },
    },
  ];
  state.updateSettings.mockReset().mockResolvedValue({ _tag: "Success" });
  state.toast.mockClear();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function open(props: ComponentProps<typeof ThreadLinksSettings>) {
  await act(() => {
    renderer = create(<ThreadLinksSettings {...props} />);
  });
  await click("Configure links");
}
async function click(text: string) {
  const button = renderer.root.findAllByType("button").find((node) => node.children.includes(text));
  expect(button).toBeDefined();
  await act(() => button?.props.onClick());
}
async function change(label: string, value: string, index = 0) {
  const inputs = renderer.root
    .findAllByType("label")
    .filter((node) => node.findAllByType("span").some((span) => span.children.includes(label)));
  await act(() => inputs[index]?.findByType("input").props.onChange({ target: { value } }));
}
async function submit() {
  await act(() => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
}

describe("thread link settings editor", () => {
  it("shows existing rules when another selected machine has no rules", async () => {
    state.environments.push({
      environmentId: second,
      label: "Second",
      connection: { phase: "connected" },
      serverConfig: { settings: { ...DEFAULT_SERVER_SETTINGS, defaultThreadLinkRules: [issue] } },
    });
    await act(() => {
      renderer = create(<ThreadLinksSettings environmentId={null} />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(issue.name);
    await act(() => {
      renderer.update(<ThreadLinksSettings environmentId={second} />);
    });
    await click("Configure links");
    await change("Name", "Updated issue");
    await submit();
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      environmentId: second,
      input: { patch: { defaultThreadLinkRules: [{ ...issue, name: "Updated issue" }] } },
    });
  });

  it("previews capture groups, validates drafts, and saves to the selected machine", async () => {
    await open({ environmentId: first });
    await click("Add rule");
    await change("Name", "Issue");
    await change("Title pattern", "#(\\d+)");
    await change("Link template", "https://tracker.example/{2}");
    await submit();
    expect(state.updateSettings).not.toHaveBeenCalled();
    await change("Link template", "https://tracker.example/{1}");
    await change("Sample thread title", "Fix #42");
    expect(renderer.root.findByType("a").props.href).toBe("https://tracker.example/42");
    await submit();
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      environmentId: first,
      input: { patch: { defaultThreadLinkRules: [issue] } },
    });
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
  });

  it("reorders rules and retains the draft after a failed save", async () => {
    const task = { name: "Task", pattern: "\\d+", urlTemplate: "https://tasks.example/{match}" };
    state.environments[0]!.serverConfig.settings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadLinkRules: [issue, task],
    };
    await open({ environmentId: first });
    await act(() => renderer.root.findByProps({ "aria-label": "Move rule 2 up" }).props.onClick());
    await change("Sample thread title", "Fix #42");
    expect(renderer.root.findByType("a").props.href).toBe("https://tasks.example/42");
    state.updateSettings.mockResolvedValueOnce({ _tag: "Failure" });
    await submit();
    expect(renderer.root.findAllByType("form")).toHaveLength(1);
    expect(state.toast).toHaveBeenCalled();
    await submit();
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      environmentId: first,
      input: { patch: { defaultThreadLinkRules: [task, issue] } },
    });
  });

  it("can disable inherited links and then restore inheritance for a project", async () => {
    state.environments[0]!.serverConfig.settings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadLinkRules: [issue],
    };
    await open({ projects: [{ environmentId: first, id: projectId }] });
    await act(() =>
      renderer.root
        .findByProps({ type: "checkbox" })
        .props.onChange({ target: { checked: false } }),
    );
    await click("Remove");
    await submit();
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      environmentId: first,
      input: { patch: { projectThreadLinkOverrides: { [projectId]: [] } } },
    });
    state.environments[0]!.serverConfig.settings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadLinkRules: [issue],
      projectThreadLinkOverrides: { [projectId]: [] },
    };
    await click("Configure links");
    await act(() =>
      renderer.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }),
    );
    await submit();
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      environmentId: first,
      input: { patch: { projectThreadLinkOverrides: { [projectId]: null } } },
    });
  });

  it("writes project overrides to every selected machine without changing defaults", async () => {
    state.environments.push({
      environmentId: second,
      label: "Second",
      connection: { phase: "connected" },
      serverConfig: { settings: DEFAULT_SERVER_SETTINGS },
    });
    await open({
      projects: [
        { environmentId: first, id: projectId },
        { environmentId: second, id: projectId },
      ],
    });
    await submit();
    expect(state.updateSettings.mock.calls).toEqual(
      [first, second].map((environmentId) => [
        { environmentId, input: { patch: { projectThreadLinkOverrides: { [projectId]: null } } } },
      ]),
    );
  });

  it("keeps a draft until every project machine is connected", async () => {
    await open({ projects: [{ environmentId: first, id: projectId }] });
    state.environments[0]!.connection.phase = "disconnected";
    await act(() =>
      renderer.update(<ThreadLinksSettings projects={[{ environmentId: first, id: projectId }]} />),
    );
    await submit();
    expect(state.updateSettings).not.toHaveBeenCalled();
    await click("Cancel");
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
  });
});
