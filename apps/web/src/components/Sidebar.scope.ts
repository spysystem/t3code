import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

type ScopeProject = Pick<SidebarProjectSnapshot, "projectKey" | "memberProjectRefs">;

/** Resolve both filters together, including projects grouped across environments. */
export function resolveSidebarScope<T extends ScopeProject>(
  projects: readonly T[],
  projectKey: string | null,
  environmentId: string | null,
) {
  const availableProjects =
    environmentId === null
      ? projects
      : projects.filter((project) =>
          project.memberProjectRefs.some((ref) => ref.environmentId === environmentId),
        );
  const selectedProject =
    availableProjects.find((project) => project.projectKey === projectKey) ?? null;
  const projectKeys =
    environmentId === null && selectedProject === null
      ? null
      : new Set(
          (selectedProject ? [selectedProject] : availableProjects).flatMap((project) =>
            project.memberProjectRefs
              .filter((ref) => environmentId === null || ref.environmentId === environmentId)
              .map((ref) => `${ref.environmentId}:${ref.projectId}`),
          ),
        );
  return { availableProjects, selectedProject, projectKeys };
}
