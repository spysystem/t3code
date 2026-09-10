import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, type ThreadLinkRule } from "@t3tools/contracts";
import { getThreadLink, resolveThreadLinkRules } from "./threadLinks.ts";

const task: ThreadLinkRule = {
  name: "Task",
  pattern: "\\b\\d{6}\\b",
  urlTemplate: "https://tracker.example/tasks/{match}",
};
const issue: ThreadLinkRule = {
  name: "Issue",
  pattern: "#(\\d+)",
  urlTemplate: "https://tracker.example/issues/{1}",
};

describe("thread links", () => {
  it("prefers canonical project rules while still reading older servers", () => {
    const projectId = ProjectId.make("project");
    const legacy = {
      defaultThreadLinkRules: [task],
      projectThreadLinkOverrides: { [projectId]: [issue] },
    };
    expect(resolveThreadLinkRules(legacy, projectId)).toEqual([issue]);
    expect(
      resolveThreadLinkRules(
        {
          ...legacy,
          projectSettingsOverrides: { [projectId]: { defaultThreadLinkRules: [] } },
        },
        projectId,
      ),
    ).toEqual([]);
    expect(
      resolveThreadLinkRules(
        {
          ...legacy,
          projectSettingsOverrides: { [projectId]: { defaultThreadLinkRules: [task] } },
        },
        projectId,
      ),
    ).toEqual([task]);
  });

  it.each(["123456", "Fix [123456]: export", "SPY-123456", "Fix #123456 / follow-up"])(
    "matches the configured six-digit pattern in %j",
    (title) => {
      expect(getThreadLink(title, [task])).toEqual({
        text: "123456",
        label: "Open Task 123456",
        url: "https://tracker.example/tasks/123456",
      });
    },
  );

  it.each(["", "Fix export", "Task 12345", "Task 1234567", "abc123456def"])(
    "does not link %j",
    (title) => {
      expect(getThreadLink(title, [task])).toBeNull();
    },
  );

  it("preserves leading zeroes and picks the first match of the first matching rule", () => {
    expect(getThreadLink("#42: Merge 012345 into 234567", [task, issue])?.url).toBe(
      "https://tracker.example/tasks/012345",
    );
    expect(getThreadLink("#42: Merge 012345 into 234567", [issue, task])?.url).toBe(
      "https://tracker.example/issues/42",
    );
  });

  it("substitutes and URL-encodes whole matches and capture groups without encoding the template", () => {
    expect(
      getThreadLink("team/a&b", [
        {
          name: "Search",
          pattern: "(team)/(.+)",
          urlTemplate: "https://tracker.example/{1}?q={2}&title={match}&controller=Task%5CView",
        },
      ])?.url,
    ).toBe("https://tracker.example/team?q=a%26b&title=team%2Fa%26b&controller=Task%5CView");
  });

  it("ignores empty matches, missing optional captures and malformed rules", () => {
    const invalid = [
      { ...issue, pattern: "(" },
      { ...issue, pattern: "a)|(?:b" },
      { ...issue, pattern: "(missing)?" },
      { ...issue, pattern: "#(\\d+)(-extra)?", urlTemplate: "https://tracker.example/{2}" },
      { ...issue, urlTemplate: "javascript:alert({1})" },
    ];
    expect(getThreadLink("#42", [...invalid, issue])?.url).toBe(
      "https://tracker.example/issues/42",
    );
  });

  it("reuses rules without retaining a previous match position", () => {
    expect(getThreadLink("#42", [issue])?.text).toBe("#42");
    expect(getThreadLink("#43", [issue])?.text).toBe("#43");
    expect(getThreadLink("renamed", [issue])).toBeNull();
  });

  it("skips captures that split a Unicode character instead of throwing during URL encoding", () => {
    expect(getThreadLink("😀 #42", [{ ...task, pattern: "." }, issue])?.text).toBe("#42");
  });

  it("inherits per environment, replaces per project, and supports an empty override", () => {
    const projectId = ProjectId.make("project");
    const other = ProjectId.make("other");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadLinkRules: [task],
      projectThreadLinkOverrides: { [projectId]: [issue], [other]: [] },
    };
    expect(resolveThreadLinkRules(settings, projectId)).toEqual([issue]);
    expect(resolveThreadLinkRules(settings, other)).toEqual([]);
    expect(resolveThreadLinkRules(settings, ProjectId.make("inherited"))).toEqual([task]);
    expect(resolveThreadLinkRules(DEFAULT_SERVER_SETTINGS, projectId)).toEqual([]);
    expect(resolveThreadLinkRules(null, projectId)).toEqual([]);
  });
});
