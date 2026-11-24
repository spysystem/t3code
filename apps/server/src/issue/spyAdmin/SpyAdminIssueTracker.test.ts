import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as IssueTrackerHost from "@t3tools/source-control-core/server/IssueTrackerHost";

import * as ServerSettings from "../../serverSettings.ts";
import * as SpyAdminIssueTracker from "./SpyAdminIssueTracker.ts";

const ADMIN_URL = "https://admin.example.test";
const target = { cwd: "/w/web", host: "admin.example.test", scope: "tasks" };

const task = (id: string, overrides: Record<string, unknown> = {}) => ({
  type: "task",
  id,
  attributes: {
    description: `Task ${id} first line\nMore words.`,
    technicalDescription: "",
    status: "in_progress",
    createdAt: "2026-11-01T09:00:00+01:00",
    updatedAt: "2026-11-02T09:00:00+01:00",
    mainTaskTitle: "",
    reportedBy: "",
  },
  relationships: {
    developer: { data: { type: "user", id: "7" } },
    assignedTo: { data: { type: "user", id: "8" } },
  },
  links: { admin: `${ADMIN_URL}/?controller=Task%5CView&action=ViewTask&iTaskID=${id}` },
  ...overrides,
});

const INCLUDED = {
  user: {
    "7": { type: "user", id: "7", attributes: { name: "Dev Eloper" } },
    "8": { type: "user", id: "8", attributes: { name: "Ann Signee" } },
  },
  // Admin sends an empty collection as a list.
  project: [],
  customer: { "3": { type: "customer", id: "3", attributes: { name: "Acme" } } },
  taskRelease: { "5": { type: "taskRelease", id: "5", attributes: { name: "2026.12" } } },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/vnd.api+json" },
  });

const activityPage = (
  entries: ReadonlyArray<Record<string, unknown>>,
  next: string | null = null,
) =>
  json({
    data: entries,
    included: { user: { "8": { type: "user", id: "8", attributes: { name: "Ann Signee" } } } },
    links: { next },
    meta: { pageToken: "listing-1" },
  });

/** An entry Ann Signee made, or nobody's when `userId` is null. */
const activity = (
  id: string,
  attributes: Record<string, unknown>,
  userId: string | null = "8",
) => ({
  type: "taskActivity",
  id,
  attributes,
  ...(userId === null ? {} : { relationships: { user: { data: { type: "user", id: userId } } } }),
});

/**
 * Answers `GET /api/v1/tasks` the way Admin would, for the task ids the request names, and a
 * task's activity from `options.activity`: none, unless a test says otherwise.
 */
function fakeAdmin(
  answer: (params: URLSearchParams) => Response | ReadonlyArray<Record<string, unknown>>,
  options: {
    readonly stored?: string | null;
    readonly url?: string;
    readonly activity?: () => Response;
  } = {},
) {
  const requests: Array<{ readonly authorization: string | undefined; readonly ids: string }> = [];
  const activityRequests: Array<{ readonly path: string; readonly page: string }> = [];
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const params = new URLSearchParams(
          request.urlParams.params.map(([name, value]): [string, string] => [name, String(value)]),
        );
        const path = new URL(request.url).pathname;
        if (path.endsWith("/activities")) {
          activityRequests.push({
            path,
            page: `${params.get("page[offset]") ?? ""}:${params.get("page[token]") ?? ""}`,
          });
          return HttpClientResponse.fromWeb(request, options.activity?.() ?? activityPage([]));
        }
        requests.push({
          authorization: request.headers.authorization,
          ids: params.get("filter[taskId]") ?? "",
        });
        const answered = answer(params);
        return HttpClientResponse.fromWeb(
          request,
          answered instanceof Response ? answered : json({ data: answered, included: INCLUDED }),
        );
      }),
    ),
  );
  const stored = options.stored === undefined ? "spy_pat_stored" : options.stored;
  const host = Layer.succeed(
    IssueTrackerHost.IssueTrackerHost,
    IssueTrackerHost.IssueTrackerHost.of({
      credentials: { get: () => Effect.succeed(Option.fromNullishOr(stored)) },
    }),
  );
  const settings = ServerSettings.ServerSettingsService.layerTest({
    spyAdminUrl: options.url ?? ADMIN_URL,
  });
  const tracker = SpyAdminIssueTracker.make.pipe(
    Effect.provide(Layer.mergeAll(http, host, settings)),
  );
  return { tracker, requests, activityRequests };
}

/** The tracker of a server that names an Admin, which the tests below all do. */
const connected = (admin: ReturnType<typeof fakeAdmin>) =>
  Effect.map(admin.tracker, (api) => {
    if (api === null) throw new Error("expected the tracker to be offered");
    return api;
  });

/** Runs a read past the window the driver gathers a batch in, which is on the test clock. */
const pastBatchWindow = <A, E>(read: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const reading = yield* Effect.forkChild(read);
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(reading);
  });

describe("SpyAdminIssueTracker", () => {
  it.effect("is offered only on a server that names an Admin", () =>
    Effect.gen(function* () {
      expect(yield* fakeAdmin(() => [], { url: "" }).tracker).toBeNull();
      expect(yield* fakeAdmin(() => [], { url: "not a url" }).tracker).toBeNull();
      // A host typed without its scheme is read as https.
      const bare = yield* connected(fakeAdmin(() => [], { url: "Admin.Example.Test" }));
      expect(bare.standalone.host).toBe("admin.example.test");
      const api = yield* connected(fakeAdmin(() => []));
      expect(api.standalone).toMatchObject({
        tracker: "spy-admin",
        host: "admin.example.test",
        environmentScope: "tasks",
      });
    }),
  );

  it.effect("recognises task links on its own host only", () =>
    Effect.gen(function* () {
      const api = yield* connected(fakeAdmin(() => []));
      expect(
        api.parseIssueUrl(
          new URL(`${ADMIN_URL}/?controller=Task%5CView&action=ViewTask&iTaskID=12345`),
        ),
      ).toEqual({
        host: "admin.example.test",
        workspace: "admin.example.test",
        scope: "tasks",
        key: "12345",
      });
      expect(api.parseIssueUrl(new URL(`${ADMIN_URL}/?controller=Task%5CView`))).toBeNull();
      expect(api.parseIssueUrl(new URL(`${ADMIN_URL}/?iTaskID=abc`))).toBeNull();
      expect(api.parseIssueUrl(new URL("https://elsewhere.test/?iTaskID=12345"))).toBeNull();
    }),
  );

  it.effect("reads a task as an issue with the tracker's own fields", () =>
    Effect.gen(function* () {
      const admin = fakeAdmin(() => [
        task("12345", {
          attributes: {
            description: "Customers cannot export.\nSeen on two systems.",
            technicalDescription: "The exporter drops the last row.",
            status: "rejected",
            priority: 2,
            createdAt: "2026-11-01T09:00:00+01:00",
            updatedAt: "2026-11-02T09:00:00+01:00",
            mainTaskTitle: "",
            reportedBy: "Sup Porter",
            dueDate: "2026-12-01",
            isDevSupport: true,
          },
          relationships: {
            developer: { data: { type: "user", id: "7" } },
            assignedTo: { data: { type: "user", id: "8" } },
            project: { data: { type: "project", id: "1" } },
            customer: { data: { type: "customer", id: "3" } },
            release: { data: { type: "taskRelease", id: "5" } },
            mainTask: { data: { type: "task", id: "12000" } },
          },
        }),
      ]);
      const api = yield* connected(admin);
      const issue = yield* pastBatchWindow(api.getIssue({ ...target, key: "#12345" }));
      // Only what Admin sends is shown: a bare task has no sections and an unnamed state.
      const bare = fakeAdmin(() => [task("7", { attributes: { description: "Export fails." } })]);
      expect(
        yield* pastBatchWindow((yield* connected(bare)).getIssue({ ...target, key: "7" })),
      ).toMatchObject({ title: "Export fails.", sections: [], state: { name: "Unknown" } });
      expect(admin.requests).toEqual([{ authorization: "Bearer spy_pat_stored", ids: "12345" }]);
      expect(issue).toMatchObject({
        key: "12345",
        displayKey: "#12345",
        title: "Customers cannot export.",
        url: `${ADMIN_URL}/?controller=Task%5CView&action=ViewTask&iTaskID=12345`,
        state: { category: "closed", name: "Rejected", closeReason: "rejected" },
        author: { login: "Sup Porter" },
        assignees: [{ login: "Ann Signee" }],
        body: "Customers cannot export.\nSeen on two systems.",
        sections: [{ title: "Technical description", body: "The exporter drops the last row." }],
        states: [],
      });
      expect(issue.fields).toEqual([
        { name: "DEV Support", value: "Yes", primary: true },
        { name: "Developer", value: "Dev Eloper", primary: true },
        { name: "Customer", value: "Acme", primary: true },
        { name: "Target release", value: "2026.12", primary: true },
        { name: "Priority", value: "2" },
        {
          name: "Main task",
          value: "#12000",
          url: `${ADMIN_URL}/?controller=Task%5CView&action=ViewTask&iTaskID=12000`,
        },
        { name: "Due date", value: "2026-12-01" },
      ]);
    }),
  );

  it.effect("reads a task's activity as its conversation, oldest first", () =>
    Effect.gen(function* () {
      const admin = fakeAdmin(() => [task("12345")], {
        activity: () =>
          activityPage(
            [
              // A kind this driver does not know is skipped, as Admin asks of its readers.
              activity("905", { kind: "call", createdAt: "2026-11-05T09:00:00+01:00" }),
              activity("904", {
                kind: "update",
                createdAt: "2026-11-04T09:00:00+01:00",
                changes: [
                  { field: "assignedTo", before: { id: "8", name: "Ann Signee" }, after: null },
                  { field: "developer", before: null, after: { id: "7", name: "Dev Eloper" } },
                  { field: "status", before: "in_progress", after: "in_review" },
                ],
              }),
              activity("903", {
                kind: "test",
                createdAt: "2026-11-03T09:00:00+01:00",
                body: "Which page?",
                testResult: "question",
                isDismissed: true,
              }),
              activity(
                "902",
                {
                  kind: "comment",
                  createdAt: "2026-11-02T09:00:00+01:00",
                  body: "See the file.",
                  files: [{ name: "shot [1].png", size: 2048, url: "https://files.test/a" }],
                },
                null,
              ),
              activity("901", {
                kind: "update",
                createdAt: "2026-11-01T09:00:00+01:00",
                changes: [
                  { field: "assignedTo", before: null, after: { id: "8", name: "Ann Signee" } },
                ],
              }),
            ],
            "https://admin.example.test/api/v1/tasks/12345/activities?page%5Boffset%5D=20",
          ),
      });
      const api = yield* connected(admin);
      expect(api.capabilities.events).toBe(true);
      const issue = yield* pastBatchWindow(api.getIssue({ ...target, key: "12345" }));
      expect(admin.activityRequests).toEqual([
        { path: "/api/v1/tasks/12345/activities", page: ":" },
      ]);
      const ann = { login: "Ann Signee", name: null, avatarUrl: null };
      expect(issue.comments).toEqual([
        {
          id: "902",
          author: null,
          body: "See the file.\n\n- [shot \\[1\\].png](https://files.test/a)",
          createdAt: "2026-11-02T09:00:00+01:00",
          url: null,
        },
        {
          id: "903",
          author: ann,
          body: "**Test question (dismissed)**\n\nWhich page?",
          createdAt: "2026-11-03T09:00:00+01:00",
          url: null,
        },
      ]);
      // A change the issue vocabulary has no word for, like the developer, is left out.
      expect(issue.events).toEqual([
        {
          id: "901:0",
          kind: "assigned",
          actor: ann,
          createdAt: "2026-11-01T09:00:00+01:00",
          detail: "Ann Signee",
        },
        {
          id: "904:0",
          kind: "unassigned",
          actor: ann,
          createdAt: "2026-11-04T09:00:00+01:00",
          detail: "Ann Signee",
        },
        {
          id: "904:2",
          kind: "state-changed",
          actor: ann,
          createdAt: "2026-11-04T09:00:00+01:00",
          detail: "In review",
        },
      ]);
      expect(issue.commentsCursor).toBe("20:listing-1");
    }),
  );

  it.effect("pages older activity from the place the page before it named", () =>
    Effect.gen(function* () {
      const admin = fakeAdmin(() => [], {
        activity: () =>
          activityPage([
            activity("802", {
              kind: "comment",
              createdAt: "2026-10-02T09:00:00+02:00",
              body: "Old",
            }),
            activity("801", {
              kind: "update",
              createdAt: "2026-10-01T09:00:00+02:00",
              changes: [
                { field: "status", before: null, after: "to_do" },
                // Admin's stand-in for no assignee is a user of its own.
                {
                  field: "assignedTo",
                  before: { id: "8", name: "Ann Signee" },
                  after: { id: "23", name: "Unassigned" },
                },
              ],
            }),
          ]),
      });
      const api = yield* connected(admin);
      const page = yield* api.getComments({ ...target, key: "12345", cursor: "20:listing-1" });
      expect(admin.activityRequests).toEqual([
        { path: "/api/v1/tasks/12345/activities", page: "20:listing-1" },
      ]);
      expect(page).toMatchObject({
        comments: [{ id: "802", body: "Old" }],
        events: [
          { id: "801:0", kind: "state-changed", detail: "To do" },
          { id: "801:1", kind: "unassigned", detail: "Ann Signee" },
        ],
        nextCursor: null,
      });
      // A cursor is a place in the task's own activity, never an address to read.
      const refused = yield* api
        .getComments({ ...target, key: "12345", cursor: "https://elsewhere.test/" })
        .pipe(Effect.flip);
      expect(refused).toMatchObject({ reason: "failed" });
      expect(admin.activityRequests).toHaveLength(1);
    }),
  );

  it.effect("reads a task from an Admin that serves no activity yet", () =>
    Effect.gen(function* () {
      const admin = fakeAdmin(() => [task("12345")], {
        activity: () => new Response("{}", { status: 404 }),
      });
      const issue = yield* pastBatchWindow(
        (yield* connected(admin)).getIssue({ ...target, key: "12345" }),
      );
      expect(issue).toMatchObject({ key: "12345", comments: [], events: [], commentsCursor: null });
    }),
  );

  it.effect("asks Admin once for the tasks read together", () =>
    Effect.gen(function* () {
      const admin = fakeAdmin((params) =>
        (params.get("filter[taskId]") ?? "")
          .split(",")
          .filter((id) => id !== "404")
          .map((id) => task(id)),
      );
      const api = yield* connected(admin);
      const results = yield* pastBatchWindow(
        Effect.forEach(
          ["101", "102", "101", "404"],
          (key) => api.getIssue({ ...target, key }).pipe(Effect.result),
          { concurrency: "unbounded" },
        ),
      );
      expect(admin.requests.map((request) => request.ids)).toEqual(["101,102,404"]);
      expect(results.map((result) => result._tag)).toEqual([
        "Success",
        "Success",
        "Success",
        "Failure",
      ]);
      expect(results[3]).toMatchObject({ failure: { reason: "not-found" } });
    }),
  );

  it.effect("reports a missing or refused token as unauthenticated", () =>
    Effect.gen(function* () {
      const unconnected = fakeAdmin(() => [], { stored: null });
      const missing = yield* (yield* connected(unconnected))
        .getIssue({ ...target, key: "1" })
        .pipe(Effect.flip);
      expect(missing).toMatchObject({ reason: "unauthenticated" });
      expect(unconnected.requests).toEqual([]);

      const refusing = fakeAdmin(() => new Response("{}", { status: 401 }));
      const refused = yield* (yield* connected(refusing))
        .probeCredential("spy_pat_new")
        .pipe(Effect.flip);
      expect(refused).toMatchObject({ reason: "unauthenticated" });
      expect(refusing.requests).toEqual([{ authorization: "Bearer spy_pat_new", ids: "" }]);
    }),
  );

  it.effect("names a token's owner from a task they develop", () =>
    Effect.gen(function* () {
      const api = yield* connected(fakeAdmin(() => [task("1")]));
      expect(yield* api.probeCredential("spy_pat_new")).toEqual({
        account: "Dev Eloper",
        scopes: [],
      });
      const idle = yield* connected(fakeAdmin(() => []));
      expect(yield* idle.probeCredential("spy_pat_new")).toEqual({
        account: "an access token",
        scopes: [],
      });
    }),
  );
});
