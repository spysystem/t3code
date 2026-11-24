/**
 * SPY Admin tasks as thread links: the tracker kind their links carry, and how people name a
 * task. The server reads tasks through this kind; clients show its links as task cards.
 */
import { parseUrl } from "./url.ts";

export const SPY_ADMIN_TRACKER = "spy-admin";

/** The task number in `12345`, `#12345` or a task link on `host`; null for anything else. */
export function parseSpyAdminTaskReference(reference: string, host: string): string | null {
  const text = reference.trim();
  const number = /^#?([1-9]\d*)$/.exec(text)?.[1];
  if (number !== undefined) return number;
  const url = parseUrl(text);
  if (url === null || url.host.toLowerCase() !== host.toLowerCase()) return null;
  return /^[1-9]\d*$/.exec(url.searchParams.get("iTaskID") ?? "")?.[0] ?? null;
}
