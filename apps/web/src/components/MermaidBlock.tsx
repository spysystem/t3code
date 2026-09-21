import { memo, useEffect, useState } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { renderMermaid } from "../lib/mermaid";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { Button } from "./ui/button";

function useMermaidImage(code: string, theme: "light" | "dark", pending: boolean) {
  const [result, setResult] = useState<{
    code: string;
    theme: string;
    url?: string;
    error?: string;
  }>();
  const current = !pending && result?.code === code && result.theme === theme ? result : undefined;

  useEffect(() => {
    if (pending) return;
    let cancelled = false;
    void renderMermaid(code, theme).then(
      (url) => {
        if (!cancelled) setResult({ code, theme, url });
      },
      () => {
        if (!cancelled)
          setResult({
            code,
            theme,
            error: "Could not render this diagram. Check the Mermaid source.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, theme, pending]);

  return {
    url: current?.url,
    status: pending ? "Waiting for diagram to finish…" : (current?.error ?? "Rendering diagram…"),
    onImageError: () =>
      setResult({ code, theme, error: "Could not display this diagram. View the Mermaid source." }),
  };
}

export const MermaidBlock = memo(function MermaidBlock({
  code,
  theme,
  pending,
  title,
}: {
  code: string;
  theme: "light" | "dark";
  pending: boolean;
  title: string | null;
}) {
  const [sourceVisible, setSourceVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "Mermaid source",
    onCopy: () => setCopyError(false),
    onError: () => setCopyError(true),
  });
  const { url, status, onImageError } = useMermaidImage(code, theme, pending);
  const label = title ?? "Mermaid diagram";
  const fence = "`".repeat(
    Array.from(code.matchAll(/`+/g)).reduce((length, [run]) => Math.max(length, run.length + 1), 3),
  );
  const markdown = `${fence}mermaid\n${code.replace(/\n$/, "")}\n${fence}\n\n`;

  return (
    <div
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-background"
      data-language="mermaid"
      data-markdown-copy={markdown}
    >
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/70 p-1.5 select-none">
        <span className="min-w-0 truncate px-1.5 font-mono text-xs">{title ?? "mermaid"}</span>
        <div className="flex items-center gap-1" role="group" aria-label="Mermaid diagram actions">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setSourceVisible((visible) => !visible)}
          >
            {sourceVisible ? "Show diagram" : "Show source"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => copyToClipboard(code, undefined)}
          >
            {isCopied ? "Copied" : "Copy source"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!url}
            onClick={() => setExpanded(true)}
          >
            Expand
          </Button>
        </div>
      </div>
      {copyError && (
        <p role="alert" className="px-3 text-xs text-muted-foreground">
          Could not copy. Select and copy the source instead.
        </p>
      )}
      {!sourceVisible && !url && (
        <p role="status" className="px-3 text-xs text-muted-foreground">
          {status}
        </p>
      )}
      {sourceVisible || !url ? (
        <pre className="overflow-x-auto p-3">
          <code className="language-mermaid">{code}</code>
        </pre>
      ) : (
        <button
          type="button"
          aria-label={`Expand ${label}`}
          className="block w-full cursor-zoom-in rounded-b-[var(--radius)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setExpanded(true)}
        >
          <img
            src={url}
            alt={label}
            draggable={false}
            className="mx-auto block max-h-[32rem] max-w-full p-3"
            onError={onImageError}
          />
        </button>
      )}
      {expanded && url && (
        <ExpandedImageDialog
          preview={{ images: [{ src: url, name: label }], index: 0 }}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
});
