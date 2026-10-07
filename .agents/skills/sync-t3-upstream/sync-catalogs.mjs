// Adds catalog keys the source now has and drops stale ones, keeping upstream's order.
// New keys get the English text in every locale, as `gt generate` does; on Windows that
// command reorders whole catalogs. Usage: node <this file> [repo-root] [--amend]
// --amend folds the result into HEAD, for `git rebase --exec` (see SKILL.md).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const amend = args.includes("--amend");
const root = NodePath.resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
const git = (...gitArgs) =>
  NodeChildProcess.spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
const catalogs = ["apps/web/src/i18n/translations", "apps/mobile/src/i18n/translations"];
if (git("grep", "-q", "^<<<<<<<", "--", ...catalogs).status === 0) {
  console.error("Catalogs still contain conflict markers.");
  process.exit(1);
}
const readJson = (file) => JSON.parse(NodeFS.readFileSync(file, "utf8"));
const written = [];

for (const app of ["apps/web", "apps/mobile"]) {
  const appDir = NodePath.join(root, app);
  const config = readJson(NodePath.join(appDir, "gt.config.json"));
  const catalogDir = NodePath.join(appDir, NodePath.dirname(config.files.gt.output));
  const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "i18n-sync-"));
  try {
    const tmpConfig = NodePath.join(tmp, "gt.config.json");
    NodeFS.writeFileSync(
      tmpConfig,
      JSON.stringify({ ...config, locales: [], files: { gt: { output: `${tmp}/[locale].json` } } }),
    );
    // oxlint-disable-next-line t3code/no-global-process-runtime -- A one-shot maintenance script.
    const shim = process.platform === "win32" ? "gt.cmd" : "gt";
    const bin = NodePath.join("node_modules", ".bin", shim);
    const result = NodeChildProcess.spawnSync(`"${bin}" generate --config "${tmpConfig}"`, {
      cwd: appDir,
      encoding: "utf8",
      shell: true,
    });
    if (result.status !== 0) {
      console.error(`${app}: gt generate failed\n${result.stdout}${result.stderr}`);
      process.exit(1);
    }
    const generated = readJson(NodePath.join(tmp, `${config.defaultLocale}.json`));
    for (const locale of [config.defaultLocale, ...config.locales]) {
      const file = NodePath.join(catalogDir, `${locale}.json`);
      const catalog = readJson(file);
      const next = {};
      let changed = false;
      for (const [key, value] of Object.entries(catalog)) {
        if (Object.hasOwn(generated, key)) next[key] = value;
        else changed = true;
      }
      for (const [key, value] of Object.entries(generated)) {
        if (!Object.hasOwn(next, key)) {
          next[key] = value;
          changed = true;
        } else if (
          locale === config.defaultLocale &&
          JSON.stringify(next[key]) !== JSON.stringify(value)
        ) {
          next[key] = value;
          changed = true;
        }
      }
      if (changed) {
        NodeFS.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
        written.push(NodePath.relative(root, file));
      }
    }
  } finally {
    NodeFS.rmSync(tmp, { recursive: true, force: true });
  }
}

if (written.length > 0) {
  const fmt = NodeChildProcess.spawnSync(`vp fmt ${written.map((f) => `"${f}"`).join(" ")}`, {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  if (fmt.status !== 0) {
    console.error(fmt.stdout + fmt.stderr);
    process.exit(1);
  }
}
console.log(written.length ? `updated ${written.join(", ")}` : "catalogs already match");
if (amend && written.length > 0) {
  for (const command of [
    ["add", "--", ...catalogs],
    ["commit", "-q", "--amend", "--no-edit"],
  ]) {
    const result = git(...command);
    if (result.status !== 0) {
      console.error(result.stdout + result.stderr);
      process.exit(1);
    }
  }
}
