import {
  threadLinkRuleError,
  type ProjectId,
  type ServerSettings,
  type ThreadLinkRule,
} from "@t3tools/contracts";

const EMPTY_RULES: ReadonlyArray<ThreadLinkRule> = [];

export function resolveThreadLinkRules(
  settings: Pick<ServerSettings, "defaultThreadLinkRules" | "projectThreadLinkOverrides"> | null,
  projectId: ProjectId,
): ReadonlyArray<ThreadLinkRule> {
  return (
    settings?.projectThreadLinkOverrides[projectId] ??
    settings?.defaultThreadLinkRules ??
    EMPTY_RULES
  );
}

const compiledRules = new WeakMap<ThreadLinkRule, RegExp | null>();

/** Rules are immutable settings values, so every row can reuse their compiled patterns. */
function patternFor(rule: ThreadLinkRule): RegExp | null {
  const cached = compiledRules.get(rule);
  if (cached !== undefined) return cached;
  const pattern = threadLinkRuleError(rule) === null ? new RegExp(rule.pattern) : null;
  compiledRules.set(rule, pattern);
  return pattern;
}

export function getThreadLink(title: string, rules: ReadonlyArray<ThreadLinkRule>) {
  for (const rule of rules) {
    const match = patternFor(rule)?.exec(title);
    if (!match?.[0]) continue;
    try {
      let missingCapture = false;
      const url = rule.urlTemplate.replace(/\{(match|[1-9]\d*)\}/g, (_, group: string) => {
        const value = match[group === "match" ? 0 : Number(group)];
        if (value === undefined) missingCapture = true;
        return encodeURIComponent(value ?? "");
      });
      if (missingCapture) continue;
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      return { text: match[0], label: `Open ${rule.name.trim()} ${match[0]}`, url };
    } catch {
      continue;
    }
  }
  return null;
}
