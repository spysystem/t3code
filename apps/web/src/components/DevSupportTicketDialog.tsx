import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { create } from "zustand";

import {
  devSupportTicketPrompt,
  findDevSupportThread,
  parseDevSupportTaskId,
} from "./devSupportTicket.logic";
import { toastManager } from "./ui/toast";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "./settings/settingsLayout";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { newMessageId, newThreadId } from "../lib/utils";
import {
  readThreadShells,
  useProjects,
  useServerConfigs,
  waitForThreadShell,
} from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const LAST_PROJECT_STORAGE_KEY = "t3code:dev-support:last-project";

const useDialogOpen = create<{ open: boolean }>(() => ({ open: false }));

/** Opens the "start from ticket" dialog from anywhere (sidebar, command palette). */
export function openDevSupportTicketDialog(): void {
  useDialogOpen.setState({ open: true });
}

export function DevSupportTicketDialogHost() {
  const open = useDialogOpen((state) => state.open);
  return open ? <DevSupportTicketDialog /> : null;
}

function readLastProjectKey(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The model picker for the chosen project's environment, as on scheduled tasks. */
function TicketModelPicker({
  environmentId,
  selection,
  disabled,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly selection: ModelSelection;
  readonly disabled: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(settings, providers, selection.instanceId, selection.model),
    [providers, selection.instanceId, selection.model, settings],
  );
  return (
    <ProviderModelPicker
      disabled={disabled}
      activeInstanceId={selection.instanceId}
      model={selection.model}
      lockedProvider={null}
      instanceEntries={instanceEntries}
      modelOptionsByInstance={modelOptionsByInstance}
      isComposerOwned={false}
      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
      onInstanceModelChange={(instanceId, model) =>
        onChange(createModelSelection(instanceId, model))
      }
    />
  );
}

function DevSupportTicketDialog() {
  const id = useId();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const router = useRouter();
  // A server without spaces would drop `space` and file the thread under Development.
  const projectItems = useMemo(
    () =>
      projects
        .filter(
          (project) =>
            serverConfigs.get(project.environmentId)?.environment.capabilities.threadSpaces ===
            true,
        )
        .map((project) => ({
          key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        }))
        .toSorted((left, right) => left.project.title.localeCompare(right.project.title)),
    [projects, serverConfigs],
  );
  const [taskInput, setTaskInput] = useState("");
  const [projectKey, setProjectKey] = useState<string | null>(() => {
    const last = readLastProjectKey();
    return projectItems.some((item) => item.key === last) ? last : (projectItems[0]?.key ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedProject = projectItems.find((item) => item.key === projectKey)?.project ?? null;
  const selectedConfig = selectedProject ? serverConfigs.get(selectedProject.environmentId) : null;
  const projectSettings = selectedProject
    ? resolveProjectSettings(
        selectedConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
        selectedProject.id,
        selectedProject,
      ).settings
    : null;
  const defaultModel = projectSettings
    ? resolveDefaultProviderModelSelection(
        selectedConfig?.providers ?? EMPTY_SERVER_PROVIDERS,
        projectSettings.defaultModelSelection,
      )
    : null;
  // A pick belongs to the project it was made for; switching project starts
  // again from that project's default, since models differ per environment.
  const [modelChoice, setModelChoice] = useState<{
    readonly projectKey: string;
    readonly selection: ModelSelection;
  } | null>(null);
  const modelSelection =
    modelChoice !== null && modelChoice.projectKey === projectKey
      ? modelChoice.selection
      : defaultModel;

  const close = () => useDialogOpen.setState({ open: false });

  const submit = async () => {
    const taskId = parseDevSupportTaskId(taskInput);
    if (taskId === null) {
      setError("Enter a task number, for example 12345.");
      return;
    }
    // A ticket already being worked on reopens its thread instead of starting over.
    const existing = findDevSupportThread(readThreadShells(), taskId);
    if (existing !== null) {
      useUiStateStore.getState().setSidebarSpace("support");
      close();
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(existing.environmentId, existing.id)),
      });
      toastManager.add({ type: "info", title: `Opened the existing thread for #${taskId}` });
      return;
    }
    const project = selectedProject;
    if (!project || !projectSettings) {
      setError("Choose a project.");
      return;
    }
    if (modelSelection === null) {
      setError("No model is available in that project's environment.");
      return;
    }
    try {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectKey!);
    } catch {
      // Remembering the project is a convenience; a full or blocked storage is not an error.
    }
    setBusy(true);
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    // The thread starts on the project checkout; the prompt has the agent move
    // it into a worktree on the customer's release. Titled "#<id>" so a second
    // Start from ticket finds it before the agent renames it.
    const thread = {
      projectId: project.id,
      space: "support" as const,
      title: `#${taskId}`,
      modelSelection,
      runtimeMode: projectSettings.defaultRuntimeMode,
      interactionMode: "default" as const,
      branch: null,
      worktreePath: null,
      createdAt,
    };
    const result = await startThreadTurn({
      environmentId: project.environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: devSupportTicketPrompt(taskId),
          attachments: [],
        },
        modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        bootstrap: { createThread: thread },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      setBusy(false);
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not start the thread.");
      return;
    }
    // The thread route treats a thread the client has not received yet as
    // deleted and sends the user home, so wait for its shell first.
    const threadRef = scopeThreadRef(project.environmentId, threadId);
    const arrived = await waitForThreadShell(threadRef);
    setBusy(false);
    useUiStateStore.getState().setSidebarSpace("support");
    close();
    if (!arrived) {
      toastManager.add({
        type: "info",
        title: `Started #${taskId}`,
        description: "It will appear under Dev support in a moment.",
      });
      return;
    }
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start from ticket</DialogTitle>
          <DialogDescription>
            Starts a Dev support thread that fetches the ticket and begins investigating.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          <form
            id={`${id}-form`}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-task`}>Task number</Label>
              <Input
                id={`${id}-task`}
                autoFocus
                inputMode="numeric"
                placeholder="12345"
                value={taskInput}
                onChange={(event) => {
                  setTaskInput(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-project`}>Project</Label>
              <Select
                value={projectKey}
                items={Object.fromEntries(
                  projectItems.map((item) => [item.key, item.project.title]),
                )}
                onValueChange={(value) => {
                  setProjectKey(value);
                  setError(null);
                }}
              >
                <SelectTrigger id={`${id}-project`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {projectItems.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {selectedProject && modelSelection ? (
              <div className="flex flex-col gap-1.5">
                <Label>Model</Label>
                <TicketModelPicker
                  environmentId={selectedProject.environmentId}
                  selection={modelSelection}
                  disabled={busy}
                  onChange={(selection) => {
                    if (projectKey !== null) setModelChoice({ projectKey, selection });
                  }}
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={busy}>
            {busy ? "Starting…" : "Start thread"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
