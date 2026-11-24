import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  threadIssueKeyOf,
  type EnvironmentId,
  type IssueDetail,
  type IssueTrackerConnection,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import { parseSpyAdminTaskReference, SPY_ADMIN_TRACKER } from "@t3tools/shared/spyAdminTasks";
import { msg, T, useGT } from "gt-react";
import { ChevronDownIcon, ChevronUpIcon, Link2OffIcon, PlusIcon } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { useQuietThreadShell, useServerConfigs } from "~/state/entities";
import { issueEnvironment } from "~/state/issues";
import { issueTrackerEnvironment } from "~/state/issueTrackers";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { connectedSpyAdminTracker } from "~/state/spyAdminTasks";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { IssueGlyph, issueStatePresentation } from "../issue/issuePresentation";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { RelativeTime } from "../RelativeTime";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

interface ThreadTasksPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The card is short on room, so every task starts as its one-line row. */
  readonly compact: boolean;
}

/**
 * The SPY Admin tasks linked to a thread, the first as a card. Hidden while none is linked and
 * Admin is not connected, so an environment without it shows nothing.
 */
export function ThreadTasksPanel(props: ThreadTasksPanelProps) {
  return <ThreadTasks key={`${props.environmentId}:${props.threadId}`} {...props} />;
}

function ThreadTasks({ environmentId, threadId, compact }: ThreadTasksPanelProps) {
  const gt = useGT();
  const threadRef = scopeThreadRef(environmentId, threadId);
  const thread = useQuietThreadShell(threadRef);
  const readsIssues =
    useServerConfigs().get(environmentId)?.environment.capabilities.issues === true;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const connections = useEnvironmentQuery(
    readsIssues && canOperate
      ? issueTrackerEnvironment.connections({ environmentId, input: {} })
      : null,
  );
  const tracker = connectedSpyAdminTracker(connections.data);
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: false });
  const [chosenKey, setChosenKey] = useState<string | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  const tasks = (thread?.issues ?? []).filter((link) => link.tracker === SPY_ADMIN_TRACKER);
  if (thread === null || (tasks.length === 0 && tracker === null)) return null;
  const firstKey = tasks[0] === undefined ? null : threadIssueKeyOf(tasks[0]);
  const openKey = chosenKey === undefined ? (compact ? null : firstKey) : chosenKey;

  const remove = async (link: ThreadIssueLink) => {
    const { tracker: kind, host, scope, key } = link;
    const result = await unlink({
      environmentId,
      input: { threadId, tracker: kind, host, scope, key },
    });
    if (result._tag !== "Failure") return;
    toastManager.add({
      type: "error",
      title: m(msg("Could not unlink the task")),
      description: readableFailure(
        squashAtomCommandFailure(result),
        m(msg("The server refused it.")),
      ),
    });
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-tasks-heading"
      title={gt("Tasks")}
      showHeading={tasks.length > 0}
      actions={
        tracker !== null && !adding && tasks.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  variant="ghost"
                  part="icon"
                  aria-label={gt("Link task")}
                  onClick={() => setAdding(true)}
                />
              }
            >
              <PlusIcon aria-hidden className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>
              <T>Link task</T>
            </TooltipPopup>
          </Tooltip>
        ) : undefined
      }
    >
      <div className="flex flex-col">
        {tasks.map((link) => {
          const key = threadIssueKeyOf(link);
          return key === openKey ? (
            <TaskCard
              key={key}
              link={link}
              threadRef={threadRef}
              readsIssues={readsIssues}
              collapsible={tasks.length > 1 || compact}
              onCollapse={() => setChosenKey(null)}
              onUnlink={canOperate ? () => void remove(link) : undefined}
            />
          ) : (
            <TaskRow
              key={key}
              link={link}
              threadRef={threadRef}
              readsIssues={readsIssues}
              onExpand={() => setChosenKey(key)}
            />
          );
        })}
        {tracker !== null && adding ? (
          <LinkTaskForm
            environmentId={environmentId}
            threadId={threadId}
            projectId={thread.projectId}
            tracker={tracker}
            linked={tasks}
            onLinked={(link) => {
              setChosenKey(threadIssueKeyOf(link));
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {tracker !== null && !adding && tasks.length === 0 ? (
          <ThreadDetailsControl
            variant="ghost"
            part="row"
            tone="muted"
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <T>Link task</T>
          </ThreadDetailsControl>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function useTask(threadRef: ScopedThreadRef, link: ThreadIssueLink, readsIssues: boolean) {
  const { projectId, tracker, host, scope, key } = link;
  return useEnvironmentQuery(
    readsIssues
      ? issueEnvironment.detail(
          {
            environmentId: threadRef.environmentId,
            input: { projectId, tracker, host, scope, key },
          },
          "thread-details",
        )
      : null,
  );
}

/**
 * The description as plain words, past the title where the title is its opening: a task with no
 * title of its own is named by its first line, which would otherwise read twice.
 */
function descriptionExcerpt(task: Pick<IssueDetail, "title" | "body">): string {
  const text = task.body
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return (text.startsWith(task.title) ? text.slice(task.title.length) : text).trim().slice(0, 600);
}

function TaskGlyph({ state }: { state: ReturnType<typeof issueStatePresentation> | null }) {
  const Icon = state?.Icon ?? IssueGlyph.issue;
  return (
    <Icon
      aria-hidden={state === null ? true : undefined}
      role={state === null ? undefined : "img"}
      aria-label={state?.label}
      className={cn("size-4 shrink-0", state?.toneClassName ?? "text-muted-foreground")}
    />
  );
}

function TaskRow({
  link,
  threadRef,
  readsIssues,
  onExpand,
}: {
  link: ThreadIssueLink;
  threadRef: ScopedThreadRef;
  readsIssues: boolean;
  onExpand: () => void;
}) {
  const detail = useTask(threadRef, link, readsIssues).data;
  return (
    <ThreadDetailsControl variant="ghost" part="row" aria-expanded={false} onClick={onExpand}>
      <TaskGlyph state={detail === null ? null : issueStatePresentation(detail.state)} />
      <span className="shrink-0 tabular-nums text-muted-foreground">{link.displayKey}</span>
      <span className="min-w-0 flex-1 truncate">{detail?.title ?? link.title}</span>
      <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </ThreadDetailsControl>
  );
}

interface TaskRow {
  readonly name: string;
  readonly value: ReactNode;
  readonly primary: boolean;
}

/** What Admin says about a task, as the label and value rows a card and a lookup both show. */
function useTaskRows(detail: IssueDetail | null): ReadonlyArray<TaskRow> {
  const gt = useGT();
  const fields = detail?.fields ?? [];
  return [
    ...(detail === null || detail.assignees.length === 0
      ? []
      : [
          {
            name: gt("Assigned to"),
            value: detail.assignees.map((actor) => actor.name ?? actor.login).join(", "),
            primary: true,
          },
        ]),
    ...fields.map((field) => ({
      name: field.name,
      value:
        field.url === undefined ? (
          field.value
        ) : (
          <a href={field.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {field.value}
          </a>
        ),
      primary: field.primary === true,
    })),
    ...(detail?.author == null
      ? []
      : [{ name: gt("Reported by"), value: detail.author.login, primary: false }]),
    ...(detail === null
      ? []
      : [
          {
            name: gt("Updated"),
            value: <RelativeTime timestamp={detail.updatedAt} />,
            primary: false,
          },
        ]),
  ];
}

function TaskRows({ rows, className }: { rows: ReadonlyArray<TaskRow>; className: string }) {
  return rows.length === 0 ? null : (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs", className)}>
      {rows.map((row) => (
        <div key={row.name} className="contents">
          <dt className="text-muted-foreground">{row.name}</dt>
          <dd className="min-w-0 truncate text-foreground/80">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TaskCard({
  link,
  threadRef,
  readsIssues,
  collapsible,
  onCollapse,
  onUnlink,
}: {
  link: ThreadIssueLink;
  threadRef: ScopedThreadRef;
  readsIssues: boolean;
  collapsible: boolean;
  onCollapse: () => void;
  onUnlink: (() => void) | undefined;
}) {
  const gt = useGT();
  const query = useTask(threadRef, link, readsIssues);
  const detail = query.data;
  const [showAll, setShowAll] = useState(false);
  const state = detail === null ? null : issueStatePresentation(detail.state);
  const title = detail?.title ?? link.title;
  const excerpt = detail === null ? "" : descriptionExcerpt(detail);
  const rows = useTaskRows(detail);
  const visibleRows = showAll ? rows : rows.filter((row) => row.primary);
  const hasMore = rows.some((row) => !row.primary);
  const ToggleIcon = showAll ? ChevronUpIcon : ChevronDownIcon;

  return (
    <div className="pb-1.5">
      <ThreadDetailsControl
        part="title"
        render={
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={gt("Task {key}: {title}", { key: link.displayKey, title })}
            onClick={(event: MouseEvent<HTMLElement>) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              if (!readsIssues) return;
              event.preventDefault();
              useRightPanelStore.getState().openIssue(threadRef, link);
            }}
          />
        }
      >
        <TaskGlyph state={state} />
        <span className="min-w-0 flex-1 line-clamp-2 whitespace-normal leading-4.5">{title}</span>
      </ThreadDetailsControl>
      {excerpt === "" ? null : (
        <p className="line-clamp-2 ps-9 pe-2.5 pt-0.5 text-xs leading-4.5 text-muted-foreground">
          {excerpt}
        </p>
      )}
      <div className="flex h-6 min-w-0 items-center gap-1.5 ps-9 pe-1 text-xs text-muted-foreground">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 tabular-nums hover:text-foreground hover:underline"
        >
          {link.displayKey}
        </a>
        {state === null ? null : <span className="min-w-0 truncate">{state.label}</span>}
        <span className="flex-1" />
        {readsIssues ? (
          <ThreadDetailsControl
            variant="ghost"
            part="icon"
            aria-label={gt("Refresh task")}
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshIcon size="xs" refreshing={query.isPending} />
          </ThreadDetailsControl>
        ) : null}
        {onUnlink === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  variant="ghost"
                  part="icon"
                  aria-label={gt("Unlink task from this thread")}
                  onClick={onUnlink}
                />
              }
            >
              <Link2OffIcon aria-hidden className="size-3" />
            </TooltipTrigger>
            <TooltipPopup>
              <T>Unlink from this thread</T>
            </TooltipPopup>
          </Tooltip>
        )}
        {collapsible ? (
          <ThreadDetailsControl
            variant="ghost"
            part="icon"
            aria-label={gt("Collapse task")}
            aria-expanded
            onClick={onCollapse}
          >
            <ChevronUpIcon aria-hidden className="size-3.5" />
          </ThreadDetailsControl>
        ) : null}
      </div>
      {detail === null && query.error !== null ? (
        <p className="ps-9 pe-2.5 pb-1 text-xs text-muted-foreground">
          <T>Could not load this task.</T>
        </p>
      ) : null}
      <TaskRows rows={visibleRows} className="ps-9 pe-2.5 pt-0.5 pb-1" />
      {hasMore ? (
        <ThreadDetailsControl
          variant="ghost"
          size="sm"
          tone="muted"
          aria-expanded={showAll}
          onClick={() => setShowAll((shown) => !shown)}
          className="w-full active:scale-100"
        >
          <ToggleIcon aria-hidden className="size-4 shrink-0" />
          {showAll ? <T>Show less</T> : <T>Show details</T>}
        </ThreadDetailsControl>
      ) : null}
    </div>
  );
}

function LinkTaskForm({
  environmentId,
  threadId,
  projectId,
  tracker,
  linked,
  onLinked,
  onCancel,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  tracker: IssueTrackerConnection & { readonly environmentScope: string };
  linked: ReadonlyArray<ThreadIssueLink>;
  onLinked: (link: Pick<ThreadIssueLink, "tracker" | "host" | "scope" | "key">) => void;
  onCancel: () => void;
}) {
  const gt = useGT();
  const link = useAtomCommand(threadEnvironment.linkIssue, { reportFailure: false });
  const [text, setText] = useState("");
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const scope = tracker.environmentScope;
  // Read before linking, so a mistyped number never becomes a card that cannot load.
  const lookup = useEnvironmentQuery(
    lookupKey === null
      ? null
      : issueEnvironment.detail({
          environmentId,
          input: {
            projectId,
            tracker: tracker.tracker,
            host: tracker.host,
            scope,
            key: lookupKey,
          },
        }),
  );
  const found = lookup.data?.key === lookupKey ? lookup.data : null;
  const foundRows = useTaskRows(found);
  const excerpt = found === null ? "" : descriptionExcerpt(found);
  const alreadyLinked = lookupKey !== null && linked.some((existing) => existing.key === lookupKey);

  const submit = async () => {
    const key = parseSpyAdminTaskReference(text, tracker.host);
    if (key === null) {
      setInvalid(true);
      return;
    }
    if (found === null || found.key !== key) {
      setLookupKey(key);
      return;
    }
    if (alreadyLinked || pending) return;
    const target = { tracker: tracker.tracker, host: tracker.host, scope, key };
    setPending(true);
    const result = await link({
      environmentId,
      input: {
        threadId,
        ...target,
        projectId,
        url: found.url,
        displayKey: found.displayKey,
        title: found.title,
        source: "manual",
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: m(msg("Could not link the task")),
        description: readableFailure(
          squashAtomCommandFailure(result),
          m(msg("The server refused it.")),
        ),
      });
      return;
    }
    onLinked(target);
  };

  const status = invalid ? (
    <T>Enter a task number or a task link.</T>
  ) : lookupKey === null ? null : alreadyLinked ? (
    <T>That task is already linked.</T>
  ) : found !== null ? null : lookup.isPending ? (
    <span className="inline-flex items-center gap-1.5">
      <Spinner className="size-3" />
      <T>Looking up the task…</T>
    </span>
  ) : lookup.failure !== null && "detail" in lookup.failure ? (
    lookup.failure.detail
  ) : (
    lookup.error
  );

  return (
    <form
      className="flex flex-col gap-1 px-2.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        size="compact"
        value={text}
        placeholder={gt("Task number or link")}
        aria-label={gt("Task number or link")}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
          setLookupKey(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      {found !== null && !alreadyLinked ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex min-w-0 items-start gap-2.5 text-sm font-medium text-foreground/80">
            <span className="mt-px inline-flex shrink-0">
              <TaskGlyph state={issueStatePresentation(found.state)} />
            </span>
            <span className="min-w-0 flex-1 line-clamp-4 leading-4.5">{found.title}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 ps-6.5 text-xs text-muted-foreground">
            <span className="shrink-0 tabular-nums">{found.displayKey}</span>
            <span className="min-w-0 truncate">{found.state.name}</span>
          </div>
          <TaskRows rows={foundRows} className="ps-6.5" />
          {excerpt === "" ? null : (
            <p className="line-clamp-5 ps-6.5 text-xs leading-4.5 text-muted-foreground">
              {excerpt}
            </p>
          )}
          <ThreadDetailsControl
            variant="ghost"
            part="row"
            tone="primary"
            type="submit"
            disabled={pending}
            className="justify-center"
          >
            <T>Link this task</T>
          </ThreadDetailsControl>
        </div>
      ) : null}
      {status === null ? null : <p className="text-xs text-muted-foreground">{status}</p>}
    </form>
  );
}
