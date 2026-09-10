import * as Schema from "effect/Schema";

/** Validate a title pattern and URL template before accepting a saved rule. */
export function threadLinkRuleError(rule: {
  readonly name: string;
  readonly pattern: string;
  readonly urlTemplate: string;
}): string | null {
  if (!rule.name.trim()) return "Enter a name for the link.";
  if (!rule.pattern) return "Enter a title pattern.";
  if (rule.pattern.length > 1024) return "Keep the title pattern under 1,025 characters.";
  let captureCount: number;
  try {
    const pattern = new RegExp(rule.pattern);
    // The empty alternative exposes the capture slots without needing a sample match.
    captureCount = (new RegExp(`(?:${pattern.source})|`).exec("")?.length ?? 1) - 1;
  } catch {
    return "Enter a valid regular expression, without / delimiters or flags.";
  }
  const placeholders = rule.urlTemplate.match(/\{[^{}]*\}/g) ?? [];
  if (placeholders.length === 0)
    return "Include {match} or a capture group such as {1} in the URL.";
  for (const placeholder of placeholders) {
    if (placeholder === "{match}") continue;
    const index = Number(placeholder.slice(1, -1));
    if (!/^\{[1-9]\d*\}$/.test(placeholder) || index > captureCount) {
      return `Unknown capture group ${placeholder}. Use {match} or an existing numbered group.`;
    }
  }
  try {
    const url = new URL(rule.urlTemplate.replace(/\{[^{}]*\}/g, "example"));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "Use an http:// or https:// URL.";
    }
  } catch {
    return "Enter a complete http:// or https:// URL.";
  }
  return null;
}

export const ThreadLinkRule = Schema.Struct({
  name: Schema.String,
  pattern: Schema.String,
  urlTemplate: Schema.String,
}).check(Schema.makeFilter((rule) => threadLinkRuleError(rule) ?? true));
export type ThreadLinkRule = typeof ThreadLinkRule.Type;

export const ThreadLinkRules = Schema.Array(ThreadLinkRule);
