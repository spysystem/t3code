import {
  EnvironmentId,
  IssueTrackerKind,
  ProjectId,
  ThreadId,
  type IssueDetail,
  type IssueTrackerConnectionList,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  issues: [] as unknown[],
  connections: null as unknown,
  detail: (_key: string): unknown => null,
  link: (_value: unknown): unknown => null,
  unlink: (_value: unknown): unknown => null,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShell: (() => ({
    id: "thread",
    environmentId: "environment",
    projectId: "project",
    issues: state.issues,
  })) as never,
  useServerConfigs: (() =>
    new Map([
      [EnvironmentId.make("environment"), { environment: { capabilities: { issues: true } } }],
    ])) as never,
}));
vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("~/state/issueTrackers"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    issueTrackerEnvironment: {
      ...actual.issueTrackerEnvironment,
      connections: (() => state.connections) as never,
    },
  };
});
vi.mock(import("~/state/issues"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    issueEnvironment: {
      ...actual.issueEnvironment,
      detail: ((target: { input: { key: string } }) => state.detail(target.input.key)) as never,
    },
  };
});
vi.mock(import("~/state/use-atom-command"), async (importOriginal) => {
  const { threadEnvironment } = await import("~/state/threads");
  return {
    ...(await importOriginal()),
    useAtomCommand: ((command: unknown) => (value: unknown) =>
      command === threadEnvironment.linkIssue ? state.link(value) : state.unlink(value)) as never,
  };
});

import { render } from "../../../test/render";
import { ThreadTasksPanel } from "./ThreadTasksPanel";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const tracker = IssueTrackerKind.make("spy-admin");
const key = { tracker, host: "admin.example.test", scope: "tasks", key: "12345" };
const link: ThreadIssueLink = {
  ...key,
  projectId: ProjectId.make("project"),
  url: "https://admin.example.test/?controller=Task%5CView&action=ViewTask&iTaskID=12345",
  source: "manual",
  linkedAt: "2026-11-01T00:00:00.000Z",
  displayKey: "#12345",
  title: "Export drops the last row",
};
const task = {
  ...link,
  author: null,
  state: { category: "open", name: "In review" },
  createdAt: link.linkedAt,
  updatedAt: link.linkedAt,
  closedAt: null,
  assignees: [{ login: "Ann Signee", name: "Ann Signee", avatarUrl: null }],
  labels: [],
  commentCount: 0,
  projectTitle: "plain",
  writable: true,
  capabilities: {
    create: false,
    edit: false,
    comment: false,
    labels: false,
    assignees: false,
    reactions: false,
    templates: false,
    linkedPullRequests: false,
    events: false,
    search: false,
  },
  viewerPermissions: {
    setState: false,
    comment: false,
    edit: false,
    labels: false,
    assignees: false,
  },
  states: [],
  viewer: null,
  body: "Export drops the last row\n\nSeen on two systems.",
  comments: [],
  commentsCursor: null,
  events: [],
  linkedPullRequests: [],
  fields: [
    { name: "Developer", value: "Dev Eloper", primary: true },
    { name: "Category", value: "Bug" },
  ],
} satisfies IssueDetail;
const connected = {
  trackers: [
    {
      tracker,
      displayName: "SPY Admin",
      host: key.host,
      scopeNoun: "task list",
      environmentScope: key.scope,
      credential: { label: "Personal access token", helpUrl: null },
      connected: true,
      account: "Dev Eloper",
      detail: null,
      scopes: [],
    },
  ],
  bindings: {},
} satisfies IssueTrackerConnectionList;

function setup(input: {
  readonly issues?: ReadonlyArray<ThreadIssueLink>;
  readonly connections?: IssueTrackerConnectionList;
}) {
  const found = Atom.make(AsyncResult.success(task));
  const missing = Atom.make(AsyncResult.initial<IssueDetail, never>());
  const connections = Atom.make(
    AsyncResult.success(input.connections ?? { trackers: [], bindings: {} }),
  );
  const link = vi.fn(async (_value: unknown) => ({ _tag: "Success" }));
  const unlink = vi.fn(async (_value: unknown) => ({ _tag: "Success" }));
  state.issues = [...(input.issues ?? [])];
  state.connections = connections;
  state.detail = (taskKey) => (taskKey === task.key ? found : missing);
  state.link = link;
  state.unlink = unlink;
  return { link, unlink };
}

const panel = () => (
  <ThreadTasksPanel environmentId={environmentId} threadId={threadId} compact={false} />
);

it("shows nothing for a thread with no task while Admin is not connected", async () => {
  setup({});
  await using _screen = await render(panel());
  await expect.element(page.getByRole("button", { name: "Link task" })).not.toBeInTheDocument();
});

it("links a task after looking it up, shows its card, and unlinks it", async () => {
  const { link: linkTask, unlink } = setup({ connections: connected });
  await using screen = await render(panel());

  await userEvent.click(page.getByRole("button", { name: "Link task" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Task number or link" }), "nonsense");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("Enter a task number or a task link.")).toBeVisible();

  // The lookup names the task before anything is linked, so a mistyped number is seen for what it is.
  await userEvent.fill(page.getByRole("textbox", { name: "Task number or link" }), "#12345");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText(task.title, { exact: true })).toBeVisible();
  await expect.element(page.getByText("Seen on two systems.")).toBeVisible();
  expect(linkTask).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole("button", { name: "Link this task" }));
  expect(linkTask).toHaveBeenCalledWith({
    environmentId,
    input: {
      threadId,
      ...key,
      projectId: link.projectId,
      url: link.url,
      displayKey: link.displayKey,
      title: link.title,
      source: "manual",
    },
  });

  state.issues = [link];
  await screen.rerender(panel());
  await expect
    .element(page.getByRole("link", { name: `Task ${link.displayKey}: ${link.title}` }))
    .toBeVisible();
  await expect.element(page.getByText("In review")).toBeVisible();
  await expect.element(page.getByText("Ann Signee")).toBeVisible();
  await expect.element(page.getByText("Dev Eloper")).toBeVisible();
  await expect.element(page.getByText("Category")).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Show details" }));
  await expect.element(page.getByText("Category")).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Unlink task from this thread" }));
  expect(unlink).toHaveBeenCalledWith({ environmentId, input: { threadId, ...key } });
});
