export const APP_FORK_LABEL = "SPY";

// Upstream's stable stage label (Alpha in older builds, Beta since 0.1.0) is
// replaced by the fork label rather than appended to it.
const STABLE_STAGE_LABELS = new Set(["alpha", "beta", "latest"]);

export function formatAppVariantLabel(stageLabel: string): string {
  return STABLE_STAGE_LABELS.has(stageLabel.trim().toLowerCase())
    ? APP_FORK_LABEL
    : `${APP_FORK_LABEL} ${stageLabel}`;
}

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  return `${input.baseName} (${formatAppVariantLabel(input.stageLabel)})`;
}
