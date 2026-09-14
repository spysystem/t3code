import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

type ScopeProject = Pick<SidebarProjectSnapshot, "projectKey" | "memberProjectRefs">;

/** Resolve both filters together, including projects grouped across environments. */
export function resolveSidebarScope<T extends ScopeProject>(
  projects: readonly T[],
  projectKeys: readonly string[],
  environmentId: string | null,
) {
  const availableProjects =
    environmentId === null
      ? projects
      : projects.filter((project) =>
          project.memberProjectRefs.some((ref) => ref.environmentId === environmentId),
        );
  const selectedProjects = availableProjects.filter((project) =>
    projectKeys.includes(project.projectKey),
  );
  const scopedProjectKeys =
    environmentId === null && selectedProjects.length === 0
      ? null
      : new Set(
          (selectedProjects.length > 0 ? selectedProjects : availableProjects).flatMap((project) =>
            project.memberProjectRefs
              .filter((ref) => environmentId === null || ref.environmentId === environmentId)
              .map((ref) => `${ref.environmentId}:${ref.projectId}`),
          ),
        );
  return { availableProjects, selectedProjects, projectKeys: scopedProjectKeys };
}
