import { getThreadLink, resolveThreadLinkRules } from "@t3tools/client-runtime/thread-links";
import {
  threadLinkRuleError,
  type EnvironmentId,
  type ProjectId,
  type ThreadLinkRule,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

type ProjectTarget = { readonly environmentId: EnvironmentId; readonly id: ProjectId };
type Scope =
  | { readonly environmentId: EnvironmentId | null; readonly projects?: never }
  | { readonly projects: ReadonlyArray<ProjectTarget>; readonly environmentId?: never };

/** Uses the shared settings selectors for environment defaults and project overrides. */
export function ScopedThreadLinksSettings() {
  const { scope } = useSettingsScope();
  if (scope.kind === "unavailable") return null;
  if (scope.kind === "project" || scope.kind === "checkout") {
    return (
      <ThreadLinksSettings
        key={JSON.stringify(scope.members.map((member) => [member.environmentId, member.id]))}
        projects={scope.members}
      />
    );
  }
  const environmentId = scope.kind === "environment" ? scope.environmentId : null;
  return <ThreadLinksSettings key={environmentId ?? "all"} environmentId={environmentId} />;
}

/** Project settings fan out to the group's physical projects, just like its other overrides. */
export function ThreadLinksSettings(scope: Scope) {
  const { environments } = useEnvironments();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [editing, setEditing] = useState(false);
  const targets = environments.filter((environment) =>
    scope.projects
      ? scope.projects.some((project) => project.environmentId === environment.environmentId)
      : scope.environmentId === null || scope.environmentId === environment.environmentId,
  );
  const connected = targets.filter(
    (target) => target.connection.phase === "connected" && target.serverConfig !== null,
  );
  const unavailable =
    connected.length === 0 ||
    (scope.projects !== undefined &&
      scope.projects.some(
        (project) => !connected.some((target) => target.environmentId === project.environmentId),
      ));
  const sources = scope.projects
    ? scope.projects.flatMap((project) => {
        const target = connected.find((target) => target.environmentId === project.environmentId);
        const settings = target?.serverConfig?.settings;
        return settings
          ? [
              {
                key: JSON.stringify([project.environmentId, project.id]),
                label: target.label,
                rules: resolveThreadLinkRules(settings, project.id),
                inherited: settings.projectThreadLinkOverrides[project.id] === undefined,
              },
            ]
          : [];
      })
    : connected.flatMap((target) =>
        target.serverConfig
          ? [
              {
                key: target.environmentId,
                label: target.label,
                rules: target.serverConfig.settings.defaultThreadLinkRules,
                inherited: false,
              },
            ]
          : [],
      );
  const rules = sources[0]?.rules ?? [];
  const inherited = sources[0]?.inherited ?? Boolean(scope.projects);
  const mixed = sources.some(
    (source) =>
      source.inherited !== inherited || JSON.stringify(source.rules) !== JSON.stringify(rules),
  );
  const scopeKey = scope.projects
    ? JSON.stringify(scope.projects.map((project) => [project.environmentId, project.id]))
    : (scope.environmentId ?? "all");

  async function save(next: ReadonlyArray<ThreadLinkRule> | null) {
    if (unavailable) return false;
    for (const target of connected) {
      const patch = scope.projects
        ? {
            projectThreadLinkOverrides: Object.fromEntries(
              scope.projects
                .filter((project) => project.environmentId === target.environmentId)
                .map((project) => [project.id, next]),
            ),
          }
        : { defaultThreadLinkRules: next ?? [] };
      const result = await updateSettings({
        environmentId: target.environmentId,
        input: { patch },
      });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: "Thread links not saved",
          description: `Could not save on ${target.label}. Earlier machines may have saved the change; try again.`,
        });
        return false;
      }
    }
    setEditing(false);
    return true;
  }

  return (
    <SettingsSection title="Thread links" id="thread-links">
      <SettingsRow
        title={scope.projects ? "Project thread links" : "Default thread links"}
        description={
          unavailable
            ? "Connect the selected machines to edit thread links."
            : mixed
              ? "Rules differ across projects or machines. Select a single machine to edit its rules. Saving here replaces the rules in the selected scope."
              : inherited
                ? "Inherited from each machine’s defaults. The first matching rule adds a link beside the thread title."
                : "The first matching rule adds a link beside the thread title. Rules are shared with all clients connected to the machine."
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable || editing}
            onClick={() => setEditing(true)}
          >
            {mixed ? "Replace selected rules" : "Configure links"}
          </Button>
        }
      />
      {editing ? (
        <ThreadLinksEditor
          key={scopeKey}
          rules={rules}
          inherited={inherited}
          project={scope.projects !== undefined}
          disabled={unavailable}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="whitespace-pre-wrap px-3 pb-3 text-sm text-muted-foreground">
          {mixed
            ? sources.map((source) => (
                <div key={source.key} className="space-y-1 py-2">
                  <p className="font-medium text-foreground">
                    {source.label}
                    {source.inherited ? " (inherited)" : ""}
                  </p>
                  {source.rules.length === 0
                    ? "No thread links configured."
                    : source.rules
                        .map((rule, index) => `${index + 1}. ${rule.name} — ${rule.pattern}`)
                        .join("\n")}
                </div>
              ))
            : rules.length === 0
              ? "No thread links configured."
              : rules
                  .map((rule, index) => `${index + 1}. ${rule.name} — ${rule.pattern}`)
                  .join("\n")}
        </div>
      )}
    </SettingsSection>
  );
}

function ThreadLinksEditor({
  rules,
  inherited,
  project,
  disabled,
  onSave,
  onCancel,
}: {
  rules: ReadonlyArray<ThreadLinkRule>;
  inherited: boolean;
  project: boolean;
  disabled: boolean;
  onSave: (rules: ReadonlyArray<ThreadLinkRule> | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState(() =>
    rules.map((rule, index) => ({ id: String(index), rule })),
  );
  const nextRuleId = useRef(rules.length);
  const draft = entries.map((entry) => entry.rule);
  const [inherit, setInherit] = useState(inherited);
  const [sample, setSample] = useState("");
  const [saving, setSaving] = useState(false);
  const errors = draft.map(threadLinkRuleError);
  const preview = getThreadLink(sample, draft);
  const update = (index: number, patch: Partial<ThreadLinkRule>) =>
    setEntries((current) =>
      current.map((entry, i) =>
        i === index ? { ...entry, rule: { ...entry.rule, ...patch } } : entry,
      ),
    );
  const move = (index: number, offset: number) =>
    setEntries((current) => {
      const next = [...current];
      const rule = next[index];
      const other = next[index + offset];
      if (rule && other) {
        next[index] = other;
        next[index + offset] = rule;
      }
      return next;
    });

  return (
    <form
      className="space-y-4 px-3 pb-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || disabled || (!inherit && errors.some(Boolean))) return;
        setSaving(true);
        try {
          await onSave(inherit ? null : draft);
        } finally {
          setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving || disabled} className="space-y-4">
        {project ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inherit}
              onChange={(event) => setInherit(event.target.checked)}
            />
            Inherit each machine’s default rules
          </label>
        ) : null}
        {!inherit ? (
          <>
            <p className="text-xs text-muted-foreground">
              Use a regular expression without / delimiters. In the URL, {"{match}"} inserts the
              whole match; {"{1}"}, {"{2}"} insert capture groups. Matched values are URL-encoded.
              An empty list disables links.
            </p>
            {entries.map(({ id, rule }, index) => (
              <div key={id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="mr-auto text-sm">Rule {index + 1}</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={`Move rule ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={`Move rule ${index + 1} down`}
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Down
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() =>
                      setEntries((current) => current.filter((entry) => entry.id !== id))
                    }
                  >
                    Remove
                  </Button>
                </div>
                <label className="block space-y-1 text-sm">
                  <span>Name</span>
                  <Input
                    value={rule.name}
                    placeholder="Issue"
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Title pattern</span>
                  <Input
                    className="font-mono"
                    value={rule.pattern}
                    placeholder={"#(\\d+)"}
                    spellCheck={false}
                    onChange={(event) => update(index, { pattern: event.target.value })}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Link template</span>
                  <Input
                    className="font-mono"
                    value={rule.urlTemplate}
                    placeholder="https://github.com/owner/repo/issues/{1}"
                    spellCheck={false}
                    onChange={(event) => update(index, { urlTemplate: event.target.value })}
                  />
                </label>
                {errors[index] ? (
                  <p className="text-xs text-destructive" role="status">
                    {errors[index]}
                  </p>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const id = String(nextRuleId.current++);
                setEntries((current) => [
                  ...current,
                  { id, rule: { name: "", pattern: "", urlTemplate: "" } },
                ]);
              }}
            >
              Add rule
            </Button>
            <label className="block space-y-1 text-sm">
              <span>Sample thread title</span>
              <Input
                value={sample}
                placeholder="Fix issue #123"
                onChange={(event) => setSample(event.target.value)}
              />
            </label>
            <div aria-live="polite" className="break-all text-sm text-muted-foreground">
              {preview ? (
                <>
                  <p>{preview.label}</p>
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {preview.url}
                  </a>
                </>
              ) : sample ? (
                "No matching link."
              ) : (
                "Enter a sample title to preview the link."
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Saving removes this project’s overrides. Each machine’s default rules will apply.
          </p>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={saving || disabled || (!inherit && errors.some(Boolean))}
        >
          {saving ? "Saving…" : "Save links"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
