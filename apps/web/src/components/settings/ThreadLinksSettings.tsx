import { getThreadLink } from "@t3tools/client-runtime/thread-links";
import { threadLinkRuleError, type ThreadLinkRule } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { persistClientSettingsPatch } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { persistScopedSettingsPatch, planScopedSettingsPatch } from "./scopedSettings";
import { useScopedSettings, useScopedSettingsMixed } from "./useScopedSettings";

export function ScopedThreadLinksSettings() {
  const { scope } = useSettingsScope();
  return (
    <ThreadLinksSettings
      key={JSON.stringify([
        scope.kind,
        scope.environmentIds,
        scope.members.map((member) => [member.environmentId, member.id]),
      ])}
    />
  );
}

/** Uses the same write planner and inheritance controls as every scoped server setting. */
function ThreadLinksSettings() {
  const { scope, environments, targets, connectedEnvironments } = useSettingsScope();
  const rules = useScopedSettings((settings) => settings.defaultThreadLinkRules);
  const mixed = useScopedSettingsMixed(["defaultThreadLinkRules"]);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [editing, setEditing] = useState(false);
  const unsupported = connectedEnvironments.filter(
    (environment) =>
      environment.serverConfig?.environment.capabilities.threadLinkProjectSettings !== true,
  );
  const unavailable = connectedEnvironments.length === 0 || unsupported.length > 0;

  async function save(next: ReadonlyArray<ThreadLinkRule>) {
    if (unavailable) return false;
    const plan = planScopedSettingsPatch(scope, environments, { defaultThreadLinkRules: next });
    if (plan.unavailableReason) {
      toastManager.add({
        type: "warning",
        title: "Thread links not saved",
        description: plan.unavailableReason,
      });
      return false;
    }
    const { failedEnvironments } = await persistScopedSettingsPatch(
      plan,
      updateSettings,
      persistClientSettingsPatch,
    );
    if (failedEnvironments.length > 0) {
      toastManager.add({
        type: "error",
        title: "Thread links not saved on every environment",
        description: `Could not update ${failedEnvironments.map((environment) => environment.label).join(", ")}. Other selected environments may have saved the change.`,
      });
      return false;
    }
    setEditing(false);
    return true;
  }

  return (
    <SettingsSection title="Thread links" id="thread-links">
      {unsupported.length > 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          Update {unsupported.map((environment) => environment.label).join(", ")} to edit thread
          links with project settings.
        </p>
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultThreadLinkRules"]}
            mixed={mixed}
            title="Thread links"
            description="The first matching title pattern adds a link to the thread. Environment defaults apply to projects that inherit them."
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
              rules={rules}
              disabled={unavailable}
              onSave={save}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="whitespace-pre-wrap px-3 pb-3 text-sm text-muted-foreground">
              {mixed
                ? targets.map((target) => (
                    <div
                      key={JSON.stringify([target.environmentId, target.projectId])}
                      className="space-y-1 py-2"
                    >
                      <p className="font-medium text-foreground">{target.label}</p>
                      {target.settings.defaultThreadLinkRules.length === 0
                        ? "No thread links configured."
                        : target.settings.defaultThreadLinkRules
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
        </>
      )}
    </SettingsSection>
  );
}

function ThreadLinksEditor({
  rules,
  disabled,
  onSave,
  onCancel,
}: {
  rules: ReadonlyArray<ThreadLinkRule>;
  disabled: boolean;
  onSave: (rules: ReadonlyArray<ThreadLinkRule>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState(() =>
    rules.map((rule, index) => ({ id: String(index), rule })),
  );
  const nextRuleId = useRef(rules.length);
  const draft = entries.map((entry) => entry.rule);
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
        if (saving || disabled || errors.some(Boolean)) return;
        setSaving(true);
        try {
          await onSave(draft);
        } finally {
          setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving || disabled} className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Use a regular expression without / delimiters. In the URL, {"{match}"} inserts the whole
          match; {"{1}"}, {"{2}"} insert capture groups. Matched values are URL-encoded. An empty
          list disables links.
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
                onClick={() => setEntries((current) => current.filter((entry) => entry.id !== id))}
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
                font="mono"
                value={rule.pattern}
                placeholder={"#(\\d+)"}
                spellCheck={false}
                onChange={(event) => update(index, { pattern: event.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Link template</span>
              <Input
                font="mono"
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
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="underline">
                {preview.url}
              </a>
            </>
          ) : sample ? (
            "No matching link."
          ) : (
            "Enter a sample title to preview the link."
          )}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || disabled || errors.some(Boolean)}>
          {saving ? "Saving…" : "Save links"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
