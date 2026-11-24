/**
 * SPY Admin tasks as issues. Tasks belong to no repository, so the tracker has one scope that
 * every project reads once a token is saved, and a task's key is its number. Read-only: Admin's
 * own approval path guards writes, and agents reach it through their task tools.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  IssueActor,
  IssueCapabilities,
  IssueComment,
  IssueEvent,
  IssueField,
  IssueState,
  IssueViewerPermissions,
} from "@t3tools/contracts";
import { parseSpyAdminTaskReference } from "@t3tools/shared/spyAdminTasks";
import {
  IssueTrackerError,
  type StandaloneIssueTrackerApi,
  type TrackerIssueDetail,
} from "@t3tools/source-control-core/server/IssueTracker";

import * as SpyAdminApi from "./SpyAdminApi.ts";

const SCOPE = "tasks";
const TITLE_MAX_LENGTH = 120;

const CAPABILITIES: IssueCapabilities = {
  create: false,
  edit: false,
  comment: false,
  labels: false,
  assignees: false,
  reactions: false,
  templates: false,
  linkedPullRequests: false,
  events: true,
  search: false,
};

const VIEWER_PERMISSIONS: IssueViewerPermissions = {
  setState: false,
  comment: false,
  edit: false,
  labels: false,
  assignees: false,
};

const STATUS_NAMES: Record<string, string> = {
  on_hold: "On hold",
  task_meeting: "Task meeting",
  to_do: "To do",
  prioritized: "Prioritized",
  in_progress: "In progress",
  in_review: "In review",
  testing: "Testing",
  completed: "Completed",
  rejected: "Rejected",
};

const statusName = (status: string) => STATUS_NAMES[status] ?? status.replaceAll("_", " ");

function toState(status: string | null): IssueState {
  if (status === null) return { category: "open", name: "Unknown" };
  const name = statusName(status);
  return status === "completed" || status === "rejected"
    ? { category: "closed", name, closeReason: status }
    : { category: "open", name };
}

/** A sub-task has no title of its own; its description's first line stands in, as Admin shows it. */
function titleOf(task: SpyAdminApi.SpyAdminTask): string {
  const firstLine = task.description
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line !== "");
  return (task.title ?? firstLine ?? `Task ${task.id}`).slice(0, TITLE_MAX_LENGTH).trim();
}

const TEST_RESULTS: Record<string, string> = {
  passed: "Test passed",
  failed: "Test failed",
  question: "Test question",
};

const actor = (name: string | null): IssueActor | null =>
  name === null ? null : { login: name, name: null, avatarUrl: null };

/** A test result has no field of its own on an issue comment, so it heads the comment's text. */
function testHeading(entry: SpyAdminApi.SpyAdminActivity): string {
  const result = TEST_RESULTS[entry.testResult ?? ""] ?? "Test result";
  return `**${result}${entry.isDismissed ? " (dismissed)" : ""}**`;
}

function toComment(entry: SpyAdminApi.SpyAdminActivity): IssueComment {
  const heading = entry.kind === "test" ? testHeading(entry) : "";
  const files = entry.files
    .map((file) => `- [${file.name.replaceAll(/[[\]]/g, "\\$&")}](${file.url})`)
    .join("\n");
  return {
    id: entry.id,
    author: actor(entry.author),
    body: [heading, entry.body, files].filter((part) => part !== "").join("\n\n"),
    createdAt: entry.createdAt,
    url: null,
  };
}

const decodeNamed = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.NonEmptyString }));
const named = (value: unknown) => Option.getOrNull(decodeNamed(value))?.name ?? null;

/**
 * The changes of one update that read as issue events; an update can hold several. A change the
 * issue vocabulary has no word for, such as a new developer or release, is left out.
 */
function toEvents(entry: SpyAdminApi.SpyAdminActivity): ReadonlyArray<IssueEvent> {
  return entry.changes.flatMap(({ field, before, after }, index): ReadonlyArray<IssueEvent> => {
    const event = (kind: IssueEvent["kind"], detail: string | null): ReadonlyArray<IssueEvent> =>
      detail === null
        ? []
        : [
            {
              id: `${entry.id}:${index}`,
              kind,
              actor: actor(entry.author),
              createdAt: entry.createdAt,
              detail,
            },
          ];
    if (field === "status")
      return event(
        "state-changed",
        typeof after === "string" && after.trim() !== "" ? statusName(after) : null,
      );
    // Admin hands a task nobody holds to a user by this name rather than to no one.
    if (field === "assignedTo")
      return after === null || named(after) === "Unassigned"
        ? event("unassigned", named(before))
        : event("assigned", named(after));
    return [];
  });
}

/** One page of activity as the conversation it adds, oldest first as every tracker hands it. */
function toConversation(page: SpyAdminApi.SpyAdminActivityPage) {
  const entries = page.entries.toReversed();
  return {
    comments: entries
      .filter((entry) => entry.kind === "comment" || entry.kind === "test")
      .map(toComment),
    events: entries.filter((entry) => entry.kind === "update").flatMap(toEvents),
  };
}

const notFound = (operation: string) =>
  new IssueTrackerError({
    tracker: SpyAdminApi.KIND,
    operation,
    reason: "not-found",
    detail: "SPY Admin has no task by that number, or this token cannot see it.",
  });

function toDetail(
  api: Pick<SpyAdminApi.SpyAdminApi, "taskUrl">,
  task: SpyAdminApi.SpyAdminTask,
  activity: SpyAdminApi.SpyAdminActivityPage,
): TrackerIssueDetail {
  const field = (
    name: string,
    value: string | null,
    extra: Partial<IssueField> = {},
  ): ReadonlyArray<IssueField> => (value === null ? [] : [{ name, value, ...extra }]);
  const timestamp = task.updatedAt ?? task.createdAt ?? "1970-01-01T00:00:00Z";
  return {
    key: task.id,
    displayKey: `#${task.id}`,
    title: titleOf(task),
    url: task.url ?? api.taskUrl(task.id),
    author: actor(task.reportedBy),
    state: toState(task.status),
    createdAt: task.createdAt ?? timestamp,
    updatedAt: timestamp,
    closedAt: null,
    assignees:
      task.assignedTo === null
        ? []
        : [{ login: task.assignedTo, name: task.assignedTo, avatarUrl: null }],
    labels: [],
    commentCount: 0,
    body: task.description,
    viewer: null,
    viewerPermissions: VIEWER_PERMISSIONS,
    states: [],
    ...toConversation(activity),
    commentsCursor: activity.nextCursor,
    linkedPullRequests: [],
    sections:
      task.technicalDescription === ""
        ? []
        : [{ title: "Technical description", body: task.technicalDescription }],
    fields: [
      ...field("DEV Support", task.isDevSupport ? "Yes" : null, { primary: true }),
      ...field("Developer", task.developer, { primary: true }),
      ...field("Customer", task.customer, { primary: true }),
      ...field("Target release", task.release, { primary: true }),
      ...field("Priority", task.priority === null ? null : String(task.priority)),
      ...field("Category", task.category),
      ...field("Project", task.project),
      ...field("Module", task.module),
      ...field("Reported in", task.reportedInRelease),
      ...field(
        "Main task",
        task.mainTaskId === null ? null : `#${task.mainTaskId}`,
        task.mainTaskId === null ? {} : { url: api.taskUrl(task.mainTaskId) },
      ),
      ...field("Due date", task.dueDate),
    ],
  };
}

/** Null on a server that names no Admin to read; see `SpyAdminApi.make`. */
export const make = Effect.map(SpyAdminApi.make, (admin): StandaloneIssueTrackerApi | null => {
  if (admin === null) return null;
  return {
    kind: SpyAdminApi.KIND,
    capabilities: CAPABILITIES,
    standalone: {
      tracker: SpyAdminApi.KIND,
      displayName: "SPY Admin",
      host: admin.host,
      scopeNoun: "task list",
      environmentScope: SCOPE,
      credential: { label: "Personal access token", helpUrl: null },
    },

    parseIssueUrl: (url) => {
      const key = parseSpyAdminTaskReference(url.href, admin.host);
      return key === null ? null : { host: admin.host, workspace: admin.host, scope: SCOPE, key };
    },

    probeCredential: (token) =>
      admin
        .owner("probeCredential", token)
        .pipe(Effect.map((owner) => ({ account: owner ?? "an access token", scopes: [] }))),

    getViewer: () => admin.owner("getViewer").pipe(Effect.map((owner) => owner ?? "me")),

    // Never listed: a tracker with an environment scope stays out of the issues page.
    listIssues: () => Effect.succeed({ items: [], nextCursor: null }),

    getIssue: Effect.fn("SpyAdminIssueTracker.getIssue")(function* (input) {
      const id = parseSpyAdminTaskReference(input.key, admin.host);
      if (id === null) return yield* notFound("getIssue");
      const [task, activity] = yield* Effect.all(
        [admin.getTask("getIssue", id), admin.getActivity("getIssue", id)],
        { concurrency: "unbounded" },
      );
      if (task === null) return yield* notFound("getIssue");
      return toDetail(admin, task, activity);
    }),

    getComments: Effect.fn("SpyAdminIssueTracker.getComments")(function* (input) {
      const id = parseSpyAdminTaskReference(input.key, admin.host);
      if (id === null) return yield* notFound("getComments");
      const page = yield* admin.getActivity("getComments", id, input.cursor);
      return { ...toConversation(page), nextCursor: page.nextCursor };
    }),
  };
});
