import { LRUCache } from "./lruCache";

const rendered = new LRUCache<string>(32, 4 * 1024 * 1024);
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

/** Keep Mermaid's global configuration and temporary DOM isolated from concurrent renders. */
export function renderMermaid(source: string, theme: "light" | "dark"): Promise<string> {
  if (source.length > 50_000) return Promise.reject(new Error("Diagram is too large to render."));
  const key = `${theme}:${source}`;
  const cached = rendered.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;

  const job = queue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "Arial, sans-serif",
      htmlLabels: false,
      maxTextSize: 50_000,
      maxEdges: 500,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "htmlLabels",
        "theme",
        "themeCSS",
        "fontFamily",
      ],
    });
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.cssText =
      "position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden;pointer-events:none";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(`t3-mermaid-${nextId++}`, source, container);
      // Explicit dimensions preserve the SVG's aspect ratio in both inline and zoomed images.
      const documentSvg = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = documentSvg.documentElement;
      const [, , width, height] = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
      if (width && height && Number.isFinite(width) && Number.isFinite(height)) {
        root.setAttribute("width", String(width));
        root.setAttribute("height", String(height));
      }
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
      rendered.set(key, url, (key.length + url.length) * 2);
      return url;
    } finally {
      container.remove();
    }
  });
  pending.set(key, job);
  queue = job.catch(() => undefined);
  void job.finally(() => pending.delete(key)).catch(() => undefined);
  return job;
}
