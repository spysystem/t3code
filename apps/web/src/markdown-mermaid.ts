import type { Root, RootContent } from "mdast";
import type { Plugin } from "unified";

/** Mark closed fences before Markdown discards the delimiters, including in lists and quotes. */
export const remarkMermaid: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value);
  const visit = (node: Root | RootContent) => {
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      const start = node.position?.start;
      const end = node.position?.end;
      const raw = source.slice(start?.offset, end?.offset);
      const opening = /^(`{3,}|~{3,})/.exec(raw)?.[1];
      const lastLine = raw.split(/\r\n|\r|\n/).at(-1) ?? "";
      const contentLines = node.value ? node.value.split(/\r\n|\r|\n/).length : 0;
      const closed = Boolean(
        opening &&
        start &&
        end &&
        end.line - start.line > contentLines &&
        new RegExp(`^[\\s>]*${opening[0]}{${opening.length},}[ \\t]*$`).test(lastLine),
      );
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, dataMermaidClosed: String(closed) },
      };
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
};
