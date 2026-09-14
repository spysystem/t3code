import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import type { RefObject } from "react";
import { useEnvironments } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/** Rendered inside the project filter popup, so connection updates only re-render it while open. */
export function SidebarEnvironmentFilter({
  environmentId,
  onChange,
  popupRef,
}: {
  environmentId: string | null;
  onChange: (environmentId: string | null) => void;
  popupRef: RefObject<HTMLDivElement | null>;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { environments } = useEnvironments();
  const items = [
    { value: "all", label: gt("All environments") },
    ...environments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
    })),
  ];
  if (environmentId !== null && !environments.some((env) => env.environmentId === environmentId)) {
    items.push({ value: environmentId, label: gt("Unavailable environment") });
  }

  return (
    <div className="shrink-0 border-b border-border/60 p-2">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        <T>Environment</T>
      </div>
      <Select
        items={items}
        value={environmentId ?? "all"}
        onValueChange={(value) => {
          if (value !== null) onChange(value === "all" ? null : value);
        }}
      >
        <SelectTrigger aria-label={gt("Filter threads by environment")} size="sm">
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
                      {connectionStatusTitle(environment.connection, messages)}
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
