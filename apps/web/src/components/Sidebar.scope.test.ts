import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveSidebarScope } from "./Sidebar.scope";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");
const sharedProjectId = ProjectId.make("shared-id");
const projects = [
  {
    projectKey: "shared-repo",
    memberProjectRefs: [
      { environmentId: laptop, projectId: sharedProjectId },
      { environmentId: server, projectId: sharedProjectId },
    ],
  },
  {
    projectKey: "server-only",
    memberProjectRefs: [{ environmentId: server, projectId: ProjectId.make("backend") }],
  },
];

describe("sidebar environment and project scope", () => {
  it("leaves all threads visible when neither filter is selected", () => {
    const scope = resolveSidebarScope(projects, null, null);
    expect(scope.availableProjects).toEqual(projects);
    expect(scope.projectKeys).toBeNull();
  });

  it("shows every project on one environment without leaking matching IDs from another", () => {
    const scope = resolveSidebarScope(projects, null, server);
    expect(scope.availableProjects).toEqual(projects);
    expect(scope.projectKeys).toEqual(new Set(["server:shared-id", "server:backend"]));
    expect(resolveSidebarScope(projects, null, laptop).availableProjects).toEqual([projects[0]]);
  });

  it("intersects a grouped repository with the selected environment", () => {
    const scope = resolveSidebarScope(projects, "shared-repo", laptop);
    expect(scope.selectedProject?.projectKey).toBe("shared-repo");
    expect(scope.projectKeys).toEqual(new Set(["laptop:shared-id"]));
    const switched = resolveSidebarScope(
      projects,
      scope.selectedProject?.projectKey ?? null,
      server,
    );
    expect(switched.selectedProject?.projectKey).toBe("shared-repo");
    expect(switched.projectKeys).toEqual(new Set(["server:shared-id"]));
  });

  it("clears an incompatible project when switching environments", () => {
    const scope = resolveSidebarScope(projects, "server-only", laptop);
    expect(scope.selectedProject).toBeNull();
    expect(scope.projectKeys).toEqual(new Set(["laptop:shared-id"]));
  });

  it("restores both environments when clearing the environment filter on a grouped project", () => {
    const scope = resolveSidebarScope(projects, "shared-repo", null);
    expect(scope.projectKeys).toEqual(new Set(["laptop:shared-id", "server:shared-id"]));
  });

  it("keeps an unavailable environment empty instead of showing another environment's threads", () => {
    const scope = resolveSidebarScope(projects, null, "offline-environment");
    expect(scope.availableProjects).toEqual([]);
    expect(scope.projectKeys).toEqual(new Set());
    expect(resolveSidebarScope([], "shared-repo", server).projectKeys).toEqual(new Set());
  });

  it("filters cached projects without depending on a live connection", () => {
    expect(resolveSidebarScope(projects, "server-only", server).projectKeys).toEqual(
      new Set(["server:backend"]),
    );
  });

  it("falls back from a removed project within the selected environment", () => {
    expect(resolveSidebarScope(projects, "removed-project", server).projectKeys).toEqual(
      new Set(["server:shared-id", "server:backend"]),
    );
  });
});
