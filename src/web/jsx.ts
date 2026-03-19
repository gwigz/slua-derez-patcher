/** Build-time JSX factory that produces HTML strings. */

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type Child = string | number | boolean | null | undefined | Child[];

function renderChildren(children: Child[]) {
  let result = "";

  for (const child of children) {
    if (child == null || child === false || child === true) continue;

    if (Array.isArray(child)) {
      result += renderChildren(child);
    } else {
      result += String(child);
    }
  }

  return result;
}

export function h(
  tag: string | ((props: Record<string, unknown>) => string),
  props: Record<string, unknown> | null,
  ...children: Child[]
) {
  if (typeof tag === "function") {
    return tag({ ...props, children: children.length === 1 ? children[0] : children });
  }

  let html = `<${tag}`;

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === "children") continue;
      if (value == null || value === false) continue;

      if (value === true) {
        html += ` ${key}`;
      } else {
        html += ` ${key}="${escapeHtml(String(value))}"`;
      }
    }
  }

  if (VOID_TAGS.has(tag)) {
    html += " />";
    return html;
  }

  html += ">";
  html += renderChildren(children);
  html += `</${tag}>`;

  return html;
}

export function Fragment({ children }: { children?: Child | Child[] }) {
  if (children == null) return "";
  if (Array.isArray(children)) return renderChildren(children);
  return String(children);
}
