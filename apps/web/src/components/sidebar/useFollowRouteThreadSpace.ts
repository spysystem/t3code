import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { useThreadShell } from "../../state/entities";
import { threadSpaceOf } from "../../threadSpace";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";

/**
 * Opening a thread from the other space (a notification, search, a link)
 * switches the sidebar to that space once, so the open thread is in the list.
 * Switching back by hand afterwards sticks until another thread is opened.
 */
export function useFollowRouteThreadSpace(): void {
  const routeThreadKey = useParams({
    strict: false,
    select: (params) => {
      const ref = resolveThreadRouteRef(params);
      return ref ? scopedThreadKey(ref) : null;
    },
  });
  const routeThreadRef = useMemo(
    () => (routeThreadKey === null ? null : parseScopedThreadKey(routeThreadKey)),
    [routeThreadKey],
  );
  const shell = useThreadShell(routeThreadRef);
  const space = shell === null ? null : threadSpaceOf(shell);
  // The shell can arrive after the route does; follow once per opened thread.
  const followedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Leaving thread routes re-arms the follow, so reopening the same thread follows again.
    if (routeThreadKey === null) {
      followedKeyRef.current = null;
      return;
    }
    if (space === null) return;
    if (followedKeyRef.current === routeThreadKey) return;
    followedKeyRef.current = routeThreadKey;
    useUiStateStore.getState().setSidebarSpace(space);
  }, [routeThreadKey, space]);
}
