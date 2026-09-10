# Project files

The Files panel shows the files in your project and opens them for reading and editing. It lists what your version control tracks or could track, so paths matched by `.gitignore` are left out by default.

## Show ignored files

Turn on **Settings → General → Show ignored files** to include ignored paths in the Files panel. This is useful for local notes, spec drafts, `.env` files, and agent scratch folders that are deliberately kept out of the repository.

Ignored folders appear collapsed and load their contents when you expand them, so large folders such as `node_modules` do not slow the panel down. Ignored entries are dimmed so they stay distinguishable from tracked files. Folders that are symlinks to somewhere outside the project, such as a notes vault in a synced drive, open like any other folder.

The setting applies to the Files panel only. The `@` mention picker and file search continue to cover tracked files, and projects without a repository show no additional entries.
