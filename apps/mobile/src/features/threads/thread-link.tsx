import { useAtomValue } from "@effect/atom-react";
import { getThreadLink, resolveThreadLinkRules } from "@t3tools/client-runtime/thread-links";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Alert, Pressable, type AccessibilityProps } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { serverEnvironment } from "../../state/server";

export function useThreadLink(thread: {
  title: string;
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(thread.environmentId));
  return getThreadLink(thread.title, resolveThreadLinkRules(settings, thread.projectId));
}

async function openThreadLink(url: string) {
  if (!(await tryOpenExternalUrl(url, "thread-link"))) {
    Alert.alert("Unable to open link", "The thread link could not be opened.");
  }
}

/** Thread rows group their children for screen readers, so expose the link as a row action too. */
export function threadLinkAccessibilityProps(
  task: ReturnType<typeof getThreadLink>,
): Pick<AccessibilityProps, "accessibilityActions" | "onAccessibilityAction"> {
  if (task === null) return {};
  return {
    accessibilityActions: [{ name: "open-thread-link", label: task.label }],
    onAccessibilityAction: ({ nativeEvent }) => {
      if (nativeEvent.actionName === "open-thread-link") void openThreadLink(task.url);
    },
  };
}

export function ThreadLink({
  task,
  selected = false,
  compact = false,
}: {
  task: NonNullable<ReturnType<typeof getThreadLink>>;
  selected?: boolean;
  compact?: boolean;
}) {
  const { materialYouStyleLayoutActive } = useAppearancePreferences();

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={task.label}
      className="max-w-40 shrink-0 flex-row items-center gap-0.5 active:opacity-70"
      hitSlop={8}
      onPress={(event) => {
        event.stopPropagation();
        void openThreadLink(task.url);
      }}
    >
      <SymbolView
        name="ticket"
        size={compact ? 13 : 11}
        tintColorClassName={
          selected
            ? materialYouStyleLayoutActive
              ? "accent-thread-selected-foreground"
              : "accent-user-bubble-foreground"
            : "accent-foreground-muted"
        }
      />
      <Text
        numberOfLines={1}
        className={cn(
          compact ? "text-sm" : "text-xs",
          "min-w-0 shrink tabular-nums",
          selected
            ? materialYouStyleLayoutActive
              ? "text-thread-selected-foreground"
              : "text-user-bubble-foreground"
            : "text-foreground-muted",
        )}
      >
        {task.text}
      </Text>
    </Pressable>
  );
}
