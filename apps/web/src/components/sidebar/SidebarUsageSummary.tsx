import { useAtomValue } from "@effect/atom-react";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  formatResetsIn,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useMemo, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSidebar } from "../ui/sidebar";
import { barColor } from "../usage/UsageLimits";

/** Rendered when the tooltip opens, so the countdown is current rather than frozen at mount. */
function SoonestReset({ pool }: { readonly pool: LimitPoolWindow }) {
  const [now] = useState(() => Date.now());
  const soonest = pool.resets.find((reset) => reset.at > now);
  const resetsIn = soonest ? formatResetsIn(soonest.member.window, now) : null;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-foreground">
        {pool.label}: {pool.remainingPercent}% left
      </span>
      {resetsIn ? <span className="text-muted-foreground">{resetsIn}</span> : null}
    </span>
  );
}

/**
 * Remaining subscription quota per provider, pooled across accounts like the
 * Usage page. Reads whatever the servers last published and never polls:
 * providers refresh their limits on their own health interval and after turns.
 */
export const SidebarUsageSummary = memo(function SidebarUsageSummary() {
  const enabled = useClientSettings((settings) => settings.sidebarUsageSummaryEnabled);
  if (!enabled) return null;
  return <SidebarUsageSummaryBox />;
});

function SidebarUsageSummaryBox() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  // `now` only feeds pace, which this box does not show.
  const [now] = useState(() => Date.now());
  const pools = useMemo(
    () => collectLimitPools(collectLimitAccounts(presentations), now),
    [now, presentations],
  );
  const openUsage = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  if (pools.length === 0) return null;

  return (
    <button
      type="button"
      aria-label="Open usage"
      onClick={openUsage}
      className="mt-1.5 flex w-full cursor-pointer flex-col gap-2 text-left rounded-lg border border-sidebar-border bg-sidebar-control-surface px-2.5 py-2 outline-hidden transition-colors hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {pools.map((pool) => {
        const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
        const color = barColor(pool.driver);
        return (
          <span key={pool.driver} className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
              <ProviderInstanceIcon
                driverKind={pool.driver}
                displayName={label}
                indicatorBackground="var(--sidebar)"
                className="size-3.5"
                iconClassName="size-3.5 text-sidebar-foreground/80"
              />
              <span className="truncate">{label}</span>
            </span>
            <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
              {displayLimitWindows(pool).map((window) => (
                <Tooltip key={`${window.kind}:${window.id}`}>
                  <TooltipTrigger
                    render={<span className="col-span-3 grid grid-cols-subgrid items-center" />}
                  >
                    <span className="truncate text-3xs text-sidebar-muted-foreground">
                      {window.label}
                    </span>
                    <span className="relative h-1 overflow-hidden rounded-full bg-sidebar-foreground/10">
                      {window.remainingPercent > 0 ? (
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${window.remainingPercent}%`, backgroundColor: color }}
                        />
                      ) : null}
                    </span>
                    <span className="text-right text-3xs font-medium text-sidebar-foreground tabular-nums">
                      {window.remainingPercent}%
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    <SoonestReset pool={window} />
                  </TooltipPopup>
                </Tooltip>
              ))}
            </span>
          </span>
        );
      })}
    </button>
  );
}
