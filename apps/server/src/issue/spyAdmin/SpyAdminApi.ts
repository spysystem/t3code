/**
 * SPY Admin's task API, signed with the personal access token saved in Settings. Admin is served
 * from the address in server settings; a server with none saved offers no such tracker.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import { IssueTrackerKind } from "@t3tools/contracts";
import { SPY_ADMIN_TRACKER } from "@t3tools/shared/spyAdminTasks";
import { parseUrl } from "@t3tools/shared/url";
import { IssueTrackerError } from "@t3tools/source-control-core/server/IssueTracker";
import * as IssueTrackerHost from "@t3tools/source-control-core/server/IssueTrackerHost";

import * as ServerSettings from "../../serverSettings.ts";

export const KIND = IssueTrackerKind.make(SPY_ADMIN_TRACKER);

/** Admin answers a list of task ids in one request, this many at most. */
const BATCH_SIZE = 25;
/** Long enough to gather the reads a sidebar of linked threads asks for at once. */
const BATCH_WINDOW = Duration.millis(25);
const TIMEOUT = Duration.seconds(30);
/** Admin pages by whole pages of one size, so every read of a task's activity asks for this many. */
const ACTIVITY_PAGE_SIZE = 20;

const TASK_PARAMS = {
  include: "developer,assignedTo,category,project,release,reportedInRelease,module,customer",
  fields_task:
    "description,technicalDescription,status,priority,createdAt,updatedAt,mainTaskTitle,reportedBy,dueDate,isDevSupport,developer,assignedTo,category,project,release,reportedInRelease,module,customer,mainTask",
  fields_user: "name",
  fields_taskCategory: "name",
  fields_project: "name",
  fields_taskRelease: "name",
  fields_module: "name",
  fields_customer: "name",
};

const Text = Schema.optional(Schema.NullOr(Schema.String));
const Related = Schema.optional(
  Schema.Struct({ data: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String }))) }),
);
type Related = typeof Related.Type;

const TaskPage = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      attributes: Schema.optional(
        Schema.Struct({
          description: Text,
          technicalDescription: Text,
          status: Text,
          priority: Schema.optional(Schema.NullOr(Schema.Number)),
          createdAt: Text,
          updatedAt: Text,
          mainTaskTitle: Text,
          reportedBy: Text,
          dueDate: Text,
          isDevSupport: Schema.optional(Schema.NullOr(Schema.Boolean)),
        }),
      ),
      relationships: Schema.optional(
        Schema.Struct({
          developer: Related,
          assignedTo: Related,
          category: Related,
          project: Related,
          release: Related,
          reportedInRelease: Related,
          module: Related,
          customer: Related,
          mainTask: Related,
        }),
      ),
      links: Schema.optional(Schema.Struct({ admin: Text })),
    }),
  ),
  // Read by hand below: Admin sends an empty collection as `[]`, not `{}`.
  included: Schema.optional(Schema.Unknown),
});
const decodeTaskPage = Schema.decodeUnknownEffect(TaskPage);

const ActivityPage = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      attributes: Schema.optional(
        Schema.Struct({
          kind: Text,
          createdAt: Text,
          body: Text,
          testResult: Text,
          isDismissed: Schema.optional(Schema.NullOr(Schema.Boolean)),
          files: Schema.optional(
            Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String }))),
          ),
          changes: Schema.optional(
            Schema.NullOr(
              Schema.Array(
                Schema.Struct({
                  field: Schema.String,
                  before: Schema.Unknown,
                  after: Schema.Unknown,
                }),
              ),
            ),
          ),
        }),
      ),
      relationships: Schema.optional(Schema.Struct({ user: Related })),
    }),
  ),
  included: Schema.optional(Schema.Unknown),
  links: Schema.optional(Schema.Struct({ next: Text })),
  meta: Schema.optional(Schema.Struct({ pageToken: Text })),
});
const decodeActivityPage = Schema.decodeUnknownEffect(ActivityPage);

const isObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const decodeNamed = Schema.decodeUnknownOption(
  Schema.Struct({ attributes: Schema.Struct({ name: Schema.String }) }),
);

/** The name of the resource a relationship points at, from the response's `included` map. */
function relatedName(included: unknown, type: string, related: Related): string | null {
  const id = related?.data?.id;
  const resources = isObject(included) ? included[type] : undefined;
  if (id === undefined || !isObject(resources)) return null;
  return present(Option.getOrUndefined(decodeNamed(resources[id]))?.attributes.name);
}

function present(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** A task with its relationships resolved to the names people read. */
export interface SpyAdminTask {
  readonly id: string;
  readonly title: string | null;
  readonly description: string;
  readonly technicalDescription: string;
  readonly status: string | null;
  readonly priority: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly dueDate: string | null;
  readonly reportedBy: string | null;
  readonly isDevSupport: boolean;
  readonly url: string | null;
  readonly developer: string | null;
  readonly assignedTo: string | null;
  readonly category: string | null;
  readonly project: string | null;
  readonly module: string | null;
  readonly customer: string | null;
  readonly release: string | null;
  readonly reportedInRelease: string | null;
  readonly mainTaskId: string | null;
}

function toTasks(page: typeof TaskPage.Type): ReadonlyMap<string, SpyAdminTask> {
  const name = (type: string, related: Related) => relatedName(page.included, type, related);
  return new Map(
    page.data.map(({ id, attributes, relationships, links }) => [
      id,
      {
        id,
        title: present(attributes?.mainTaskTitle),
        description: attributes?.description?.trim() ?? "",
        technicalDescription: attributes?.technicalDescription?.trim() ?? "",
        status: present(attributes?.status),
        priority: attributes?.priority ?? null,
        createdAt: present(attributes?.createdAt),
        updatedAt: present(attributes?.updatedAt),
        dueDate: present(attributes?.dueDate),
        reportedBy: present(attributes?.reportedBy),
        isDevSupport: attributes?.isDevSupport === true,
        url: present(links?.admin),
        developer: name("user", relationships?.developer),
        assignedTo: name("user", relationships?.assignedTo),
        category: name("taskCategory", relationships?.category),
        project: name("project", relationships?.project),
        module: name("module", relationships?.module),
        customer: name("customer", relationships?.customer),
        release: name("taskRelease", relationships?.release),
        reportedInRelease: name("taskRelease", relationships?.reportedInRelease),
        mainTaskId: present(relationships?.mainTask?.data?.id),
      },
    ]),
  );
}

/** One entry of a task's activity: a comment, a test result, or an update with its changes. */
export interface SpyAdminActivity {
  readonly id: string;
  /** `comment`, `test` or `update`; Admin may add kinds, which a reader skips. */
  readonly kind: string;
  readonly createdAt: string;
  readonly author: string | null;
  readonly body: string;
  readonly testResult: string | null;
  readonly isDismissed: boolean;
  readonly files: ReadonlyArray<{ readonly name: string; readonly url: string }>;
  readonly changes: ReadonlyArray<{
    readonly field: string;
    readonly before: unknown;
    readonly after: unknown;
  }>;
}

export interface SpyAdminActivityPage {
  /** Newest first, as Admin lists them. */
  readonly entries: ReadonlyArray<SpyAdminActivity>;
  /** Where older entries carry on; null once the task's activity is whole. */
  readonly nextCursor: string | null;
}

const NO_ACTIVITY: SpyAdminActivityPage = { entries: [], nextCursor: null };

function toActivityPage(page: typeof ActivityPage.Type, offset: number): SpyAdminActivityPage {
  return {
    entries: page.data.flatMap(({ id, attributes, relationships }) => {
      const kind = present(attributes?.kind);
      const createdAt = present(attributes?.createdAt);
      if (kind === null || createdAt === null) return [];
      return [
        {
          id,
          kind,
          createdAt,
          author: relatedName(page.included, "user", relationships?.user),
          body: attributes?.body?.trim() ?? "",
          testResult: present(attributes?.testResult),
          isDismissed: attributes?.isDismissed === true,
          files: attributes?.files ?? [],
          changes: attributes?.changes ?? [],
        },
      ];
    }),
    // A page token keeps the listing as the first read saw it, so later pages do not shift.
    nextCursor:
      present(page.links?.next) === null
        ? null
        : `${offset + ACTIVITY_PAGE_SIZE}:${page.meta?.pageToken ?? ""}`,
  };
}

const fail = (operation: string, reason: IssueTrackerError["reason"], detail: string) =>
  new IssueTrackerError({ tracker: KIND, operation, reason, detail });
const unexpectedBody = (operation: string) =>
  fail(operation, "failed", "SPY Admin returned an unexpected body.");

interface GetTask extends Request.Request<SpyAdminTask | null, IssueTrackerError> {
  readonly _tag: "SpyAdminGetTask";
  readonly operation: string;
  readonly token: string;
  readonly id: string;
}
const GetTask = Request.tagged<GetTask>("SpyAdminGetTask");

export interface SpyAdminApi {
  /** Where Admin is served from, as its task links name it. */
  readonly host: string;
  readonly taskUrl: (id: string) => string;
  /** Null when Admin has no such task, or the token cannot see it. Reads with the stored token. */
  readonly getTask: (
    operation: string,
    id: string,
  ) => Effect.Effect<SpyAdminTask | null, IssueTrackerError>;
  /**
   * A page of a task's activity: the newest without a cursor, else the page an earlier one named.
   * Empty for a task Admin does not have, and on an Admin too old to serve activity.
   */
  readonly getActivity: (
    operation: string,
    id: string,
    cursor?: string,
  ) => Effect.Effect<SpyAdminActivityPage, IssueTrackerError>;
  /**
   * Who a token belongs to, which also vets it. Admin has no endpoint for that, so the name is
   * read off a task the owner develops, and is null for an owner who develops none.
   */
  readonly owner: (
    operation: string,
    token?: string,
  ) => Effect.Effect<string | null, IssueTrackerError>;
}

/** A saved address may leave the scheme out, as people type a host. */
function parseAddress(address: string): URL | null {
  return parseUrl(address.includes("://") ? address : `https://${address}`);
}

/** Null on a server that names no Admin to read. The address is read once, at server start. */
export const make: Effect.Effect<
  SpyAdminApi | null,
  never,
  HttpClient.HttpClient | IssueTrackerHost.IssueTrackerHost | ServerSettings.ServerSettingsService
> = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const address = yield* settings.getSettings.pipe(
    Effect.map((saved) => saved.spyAdminUrl),
    Effect.orElseSucceed(() => ""),
  );
  const origin = address === "" ? null : parseAddress(address);
  if (origin === null) {
    if (address !== "")
      yield* Effect.logWarning(
        "The saved SPY Admin address is not a URL; SPY Admin is not offered.",
      );
    return null;
  }
  const http = yield* HttpClient.HttpClient;
  const host = yield* IssueTrackerHost.IssueTrackerHost;

  const storedToken = (operation: string) =>
    host.credentials
      .get(KIND)
      .pipe(
        Effect.flatMap(
          Effect.fromOption(() =>
            fail(operation, "unauthenticated", "SPY Admin is not connected on this server."),
          ),
        ),
      );

  /** The body Admin answers a read with, or null where it has nothing at that path. */
  const read = Effect.fn("SpyAdminApi.read")(function* (
    operation: string,
    token: string,
    path: string,
    params: Record<string, string>,
  ) {
    const response = yield* http
      .execute(
        HttpClientRequest.get(new URL(path, origin)).pipe(
          HttpClientRequest.setUrlParams(params),
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setHeader("accept", "application/vnd.api+json"),
          HttpClientRequest.setHeader("user-agent", "t3code-issue-tracker"),
        ),
      )
      .pipe(
        Effect.mapError(() => fail(operation, "failed", "SPY Admin could not be reached.")),
        Effect.timeoutOrElse({
          duration: TIMEOUT,
          orElse: () => Effect.fail(fail(operation, "failed", "SPY Admin did not answer in time.")),
        }),
      );
    if (response.status === 401 || response.status === 403)
      return yield* fail(operation, "unauthenticated", "SPY Admin rejected the access token.");
    if (response.status === 429)
      return yield* fail(operation, "rate-limited", "SPY Admin's rate limit was reached.");
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300)
      return yield* fail(operation, "failed", `SPY Admin returned HTTP ${response.status}.`);
    return yield* response.json.pipe(Effect.mapError(() => unexpectedBody(operation)));
  });

  const listTasks = Effect.fn("SpyAdminApi.listTasks")(function* (
    operation: string,
    token: string,
    params: Record<string, string>,
  ) {
    const body = yield* read(operation, token, "/api/v1/tasks", { ...TASK_PARAMS, ...params });
    if (body === null) return yield* fail(operation, "failed", "SPY Admin returned HTTP 404.");
    const page = yield* decodeTaskPage(body).pipe(Effect.mapError(() => unexpectedBody(operation)));
    return toTasks(page);
  });

  const listActivity = Effect.fn("SpyAdminApi.listActivity")(function* (
    operation: string,
    token: string,
    id: string,
    cursor: string | undefined,
  ) {
    const from = cursor === undefined ? null : /^(\d+):(.*)$/.exec(cursor);
    if (cursor !== undefined && from === null)
      return yield* fail(operation, "failed", "That is not a place in this task's activity.");
    const offset = from === null ? 0 : Number(from[1]);
    const body = yield* read(operation, token, `/api/v1/tasks/${id}/activities`, {
      include: "user",
      fields_user: "name",
      "page[limit]": String(ACTIVITY_PAGE_SIZE),
      ...(from === null ? {} : { "page[offset]": String(offset), "page[token]": from[2] ?? "" }),
    });
    if (body === null) return NO_ACTIVITY;
    const page = yield* decodeActivityPage(body).pipe(
      Effect.mapError(() => unexpectedBody(operation)),
    );
    return toActivityPage(page, offset);
  });

  // One request per token for the ids asked for together, so a sidebar of linked threads costs
  // Admin a request or two rather than one per thread.
  const taskResolver = RequestResolver.makeGrouped<GetTask, string>({
    key: ({ request }) => request.token,
    resolver: (entries, token) =>
      listTasks(entries[0].request.operation, token, {
        "filter[taskId]": [...new Set(entries.map((entry) => entry.request.id))].join(","),
        "page[limit]": String(BATCH_SIZE),
      }).pipe(
        Effect.exit,
        Effect.map((exit) => {
          for (const entry of entries)
            entry.completeUnsafe(Exit.map(exit, (tasks) => tasks.get(entry.request.id) ?? null));
        }),
      ),
  }).pipe(RequestResolver.batchN(BATCH_SIZE), RequestResolver.setDelay(BATCH_WINDOW));

  return {
    host: origin.host.toLowerCase(),
    taskUrl: (id) => {
      const url = new URL("/", origin);
      url.searchParams.set("controller", "Task\\View");
      url.searchParams.set("action", "ViewTask");
      url.searchParams.set("iTaskID", id);
      return url.href;
    },
    getTask: (operation, id) =>
      storedToken(operation).pipe(
        Effect.flatMap((token) => Effect.request(GetTask({ operation, token, id }), taskResolver)),
      ),
    getActivity: (operation, id, cursor) =>
      storedToken(operation).pipe(
        Effect.flatMap((token) => listActivity(operation, token, id, cursor)),
      ),
    owner: (operation, token) =>
      (token === undefined ? storedToken(operation) : Effect.succeed(token)).pipe(
        Effect.flatMap((key) =>
          listTasks(operation, key, { "filter[developer]": "me", "page[limit]": "1" }),
        ),
        Effect.map((tasks) => tasks.values().next().value?.developer ?? null),
      ),
  } satisfies SpyAdminApi;
});
