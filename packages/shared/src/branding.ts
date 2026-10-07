export const APP_FORK_LABEL = "SPY";

export function formatAppVariantLabel(stageLabel: string): string {
  const normalized = stageLabel.trim().toLowerCase();
  return normalized === "alpha" || normalized === "latest"
    ? APP_FORK_LABEL
    : `${APP_FORK_LABEL} ${stageLabel}`;
}

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  return `${input.baseName} (${formatAppVariantLabel(input.stageLabel)})`;
}
