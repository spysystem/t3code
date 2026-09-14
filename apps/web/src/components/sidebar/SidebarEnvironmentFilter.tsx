import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import type { RefObject } from "react";
import type { EnvironmentPresentation } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function SidebarEnvironmentFilter({
  environments,
  environmentId,
  onChange,
  popupRef,
}: {
  environments: readonly EnvironmentPresentation[];
  environmentId: string | null;
  onChange: (environmentId: string | null) => void;
  popupRef: RefObject<HTMLDivElement | null>;
}) {
  const items = [
    { value: "all", label: "All environments" },
    ...environments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
    })),
  ];
  if (environmentId !== null && !environments.some((env) => env.environmentId === environmentId)) {
    items.push({ value: environmentId, label: "Unavailable environment" });
  }

  return (
    <div className="shrink-0 border-b border-border/60 p-2">
      <div className="mb-1 text-xs font-medium text-muted-foreground">Environment</div>
      <Select
        items={items}
        value={environmentId ?? "all"}
        onValueChange={(value) => {
          if (value !== null) onChange(value === "all" ? null : value);
        }}
      >
        <SelectTrigger aria-label="Filter threads by environment" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup ref={popupRef} alignItemWithTrigger={false}>
          {items.map((item) => {
            const environment = environments.find((env) => env.environmentId === item.value);
            return (
              <SelectItem key={item.value} value={item.value}>
                <span className="flex min-w-0 items-center gap-2">
                  {environment ? (
                    <EnvironmentMachineIcon
                      aria-hidden
                      kind={resolveEnvironmentMachineKind(environment.serverConfig)}
                      className="size-3.5 shrink-0"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {environment ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {connectionStatusTitle(environment.connection)}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
    </div>
  );
}
