import type { Diagnostic } from "typescript";
import * as tstl from "typescript-to-lua";
import { minify } from "html-minifier-terser";
import { Project, SyntaxKind } from "ts-morph";
import { watch, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import * as constants from "./src/constants";

const WATCH = process.argv.includes("--watch");
const GENERATED_HEADER = "--[[ Generated with @gwigz/slua - https://github.com/gwigz/slua ]]";

/** Slot marker pattern for splitting compiled HTML into segments. */
const SLOT_PATTERN = /__SLOT_([a-zA-Z0-9_]+)__/;

/** All .tsx source files in src/patcher/ that compile to .ts at build time. */
const TSX_SOURCES = readdirSync(resolve("src/patcher"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => resolve("src/patcher", f));

/** Generated .ts files that should not trigger rebuilds in watch mode. */
const GENERATED_FILES = TSX_SOURCES.map((f) => "patcher/" + basename(f, ".tsx") + ".ts");

/** Inlined JSX runtime prepended to build-time temp files. */
const JSX_RUNTIME = `/** @jsx h */
/** @jsxFrag Fragment */
const VOID_TAGS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"]);
function escapeHtml(value) { return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }
function renderChildren(children) { let result = ""; for (const child of children) { if (child === null || child === undefined || child === false || child === true) continue; if (Array.isArray(child)) { result += renderChildren(child); } else { result += String(child); } } return result; }
function h(tag, props, ...children) { if (typeof tag === "function") return tag({ ...props, children: children.length === 1 ? children[0] : children }); let html = "<" + tag; if (props) { for (const [key, value] of Object.entries(props)) { if (key === "children") continue; if (value === null || value === undefined || value === false) continue; if (value === true) html += " " + key; else html += " " + key + '="' + escapeHtml(String(value)) + '"'; } } if (VOID_TAGS.has(tag)) return html + " />"; html += ">"; html += renderChildren(children); return html + "</" + tag + ">"; }
function Fragment({ children }) { if (children == null) return ""; if (Array.isArray(children)) return renderChildren(children); return String(children); }
`;

/** Extracts the leading JSDoc block from a source file and converts it to a Lua multiline comment. */
function extractFileComment(sourcePath: string): string {
  const source = readFileSync(resolve(sourcePath), "utf8");
  const match = source.match(/^\/\*\*\n([\s\S]*?)\s*\*\//);

  if (!match) {
    return "";
  }

  const body = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();

  return `--[[\n${body}\n]]`;
}

/** Extracts JSDoc comments paired with their export names from constants.ts. */
function getConstantComments(): Record<string, string> {
  const source = readFileSync(resolve("src/constants.ts"), "utf8");
  const comments: Record<string, string> = {};
  const re = /\/\*\*\s*(.*?)\s*\*\/\s*\nexport const (\w+)/g;

  let match;

  while ((match = re.exec(source))) {
    comments[match[2]] = match[1];
  }

  return comments;
}

/** Generates short CSS class names: a, b, ..., z, aa, ab, ... */
function shortClassName(i: number): string {
  if (i < 26) return String.fromCharCode(97 + i);
  const first = Math.floor((i - 26) / 26);
  const second = (i - 26) % 26;
  return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
}

interface ShorteningMap {
  classes: [string, string][];
  ids: [string, string][];
  cssVarAliases: [string, string][];
  cssVarRootBlock: string;
  booleanAttrs: string[];
}

/**
 * Builds a shortening map from concatenated HTML strings.
 * Extracts CSS class names, element IDs, CSS variable aliases, and boolean
 * attributes to collapse. Operates on raw HTML — never on compiled Lua.
 */
function buildShorteningMap(allHtml: string): ShorteningMap {
  // 1. CSS class names from <style> blocks
  const classes: [string, string][] = [];
  const styleMatch = allHtml.match(/<style>([\s\S]*?)<\/style>/);

  if (styleMatch) {
    const css = styleMatch[1];
    const classNames = new Set<string>();
    const classRe = /\.([a-z][a-z0-9-]*)/g;
    let match;

    while ((match = classRe.exec(css))) {
      classNames.add(match[1]);
    }

    const sorted = [...classNames].sort((a, b) => b.length - a.length || a.localeCompare(b));

    for (let i = 0; i < sorted.length; i++) {
      classes.push([sorted[i], shortClassName(i)]);
    }
  }

  // 2. Element IDs from id="..." (raw HTML quotes, not Lua-escaped)
  const idSet = new Set<string>();
  const idRe = /id="([a-z][a-z-]+)"/g;
  let idMatch;

  while ((idMatch = idRe.exec(allHtml))) {
    idSet.add(idMatch[1]);
  }

  const sortedIds = [...idSet].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const ids: [string, string][] = [];

  for (let i = 0; i < sortedIds.length; i++) {
    ids.push([sortedIds[i], shortClassName(i)]);
  }

  // 3. CSS var(--pico-*) aliases — only when aliasing saves bytes
  const varRe = /var\(--pico-[a-z-]+\)/g;
  const varCounts = new Map<string, number>();

  for (const m of allHtml.matchAll(varRe)) {
    varCounts.set(m[0], (varCounts.get(m[0]) || 0) + 1);
  }

  const cssVarAliases: [string, string][] = [];
  let cssVarRootBlock = "";

  const varsToAlias = [...varCounts.entries()]
    .filter(([ref, count]) => {
      const defCost = `--_${shortClassName(0)}:${ref};`.length;
      const saved = count * (ref.length - `var(--_${shortClassName(0)})`.length);
      return saved > defCost;
    })
    .sort((a, b) => b[1] - a[1]);

  if (varsToAlias.length > 0) {
    const aliasDefs: string[] = [];

    for (let i = 0; i < varsToAlias.length; i++) {
      const [ref] = varsToAlias[i];
      const alias = `--_${shortClassName(i)}`;
      cssVarAliases.push([ref, `var(${alias})`]);
      aliasDefs.push(`${alias}:${ref}`);
    }

    cssVarRootBlock = `:root{${aliasDefs.join(";")}}`;
  }

  return {
    classes,
    ids,
    cssVarAliases,
    cssVarRootBlock,
    booleanAttrs: ["checked", "defer"],
  };
}

/**
 * Applies all shortening transformations to an HTML string.
 * Safe to call on any fragment — patterns that don't match are no-ops.
 */
function applyShorteningMap(html: string, map: ShorteningMap): string {
  // 1. Shorten CSS class names (longest-first to avoid substring collisions)
  for (const [long, short] of map.classes) {
    html = html.replaceAll(long, short);
  }

  // 2. Alias CSS custom properties
  for (const [ref, alias] of map.cssVarAliases) {
    html = html.replaceAll(ref, alias);
  }

  if (map.cssVarRootBlock) {
    html = html.replace("<style>", `<style>${map.cssVarRootBlock}`);
  }

  // 3. Shorten element IDs and their references (e.g. hx-target="#id")
  for (const [long, short] of map.ids) {
    html = html.replaceAll(`id="${long}"`, `id="${short}"`);
    html = html.replaceAll(`#${long}`, `#${short}`);
  }

  // 4. Collapse boolean attributes (checked="checked" → checked="")
  for (const attr of map.booleanAttrs) {
    html = html.replaceAll(`${attr}="${attr}"`, `${attr}=""`);
  }

  return html;
}

/** Prepends file header comment and constants to a compiled .slua file. */
function injectConstants(filePath: string, sourcePath: string, comments: Record<string, string>) {
  const content = readFileSync(filePath, "utf8");
  const header = extractFileComment(sourcePath);

  const lines = Object.entries(constants)
    .filter(([name]) => content.includes(name))
    .map(([name, value]) => {
      const comment = comments[name];
      return comment ? `--- ${comment}\nlocal ${name} = ${value}` : `local ${name} = ${value}`;
    });

  const parts: string[] = [];

  if (header) {
    parts.push(header);
  }

  if (lines.length > 0) {
    parts.push(lines.join("\n\n"));
  }

  parts.push(GENERATED_HEADER);

  writeFileSync(filePath, parts.join("\n\n") + "\n" + content);
}

/** Generates src/constants.d.ts from the exports in src/constants.ts. */
function generateConstantDeclarations(comments: Record<string, string>) {
  const declarations = Object.entries(constants)
    .map(([name, value]) => {
      const comment = comments[name];
      const decl = `declare const ${name}: ${typeof value};`;
      return comment ? `/** ${comment} */\n${decl}` : decl;
    })
    .join("\n\n");

  writeFileSync(
    resolve("src/types/globals.d.ts"),
    `// Auto-generated from constants.ts -- run \`bun dev\` to update\n\n${declarations}\n`,
  );
}

// XHTML-safe minification: keep attribute quotes and self-closing slashes
const minifyHtml = (html: string) =>
  minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: { output: { comments: /CDATA|\]\]>/ } },
    keepClosingSlash: true,
  });

/** Splits HTML on slot markers into segment arrays. */
function splitFragment(name: string, html: string) {
  const parts = html.split(SLOT_PATTERN);
  const segments: string[] = [];
  const slotNames: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      segments.push(parts[i]);
    } else {
      slotNames.push(parts[i]);
    }
  }

  for (const seg of segments) {
    if (/__SLOT_/.test(seg)) {
      throw new Error(`Fragment "${name}" has residual slot markers`);
    }
  }

  return { segments, slotNames };
}

/** Returns true if a ts-morph node is or contains any JSX elements. */
function hasJsx(node: import("ts-morph").Node): boolean {
  const kind = node.getKind();
  return (
    kind === SyntaxKind.JsxElement ||
    kind === SyntaxKind.JsxSelfClosingElement ||
    node.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
  );
}

/**
 * Evaluates a single .tsx file at build time, returning minified HTML strings
 * and AST references for later code generation.
 *
 * Phase A: auto-detects template declarations, evaluates JSX via Bun,
 * and minifies the resulting HTML.
 */
async function evaluateTsxModule(tsxPath: string) {
  const project = new Project({ compilerOptions: { jsx: 2 /* React */ } });
  const source = project.addSourceFileAtPath(tsxPath);

  // 1. Auto-detect template declarations by JSX content
  const templateFns = source.getFunctions().filter((fn) => hasJsx(fn));
  const templateVars = source.getVariableDeclarations().filter((decl) => {
    const init = decl.getInitializer();
    return init !== undefined && hasJsx(init);
  });

  // 2. Detect dependency consts (non-JSX top-level consts referenced by templates)
  const templateCode = [
    ...templateFns.map((fn) => fn.getText()),
    ...templateVars.map((decl) => decl.getInitializer()!.getText()),
  ].join("\n");

  const depStmts = source.getVariableStatements().filter((stmt) => {
    const decls = stmt.getDeclarations();

    if (
      decls.some((d) => {
        const init = d.getInitializer();
        return init && hasJsx(init);
      })
    ) {
      return false;
    }
    return decls.some((d) => new RegExp(`\\b${d.getName()}\\b`).test(templateCode));
  });

  // 3. Build temp file: JSX runtime + dependencies + template wrappers
  const tempLines = [JSX_RUNTIME];

  for (const stmt of depStmts) {
    tempLines.push(stmt.getText());
  }

  for (const fn of templateFns) {
    const name = fn.getName()!;
    const paramNames = fn.getParameters().map((p) => p.getName());
    tempLines.push(fn.getText());
    const markerArgs = paramNames.map((p) => `"__SLOT_${p}__"`).join(", ");
    tempLines.push(`export const __${name} = ${name}(${markerArgs});`);
  }

  for (const decl of templateVars) {
    const stmt = decl.getVariableStatement()!;
    const text = stmt.getText();
    tempLines.push(text.startsWith("export") ? text : "export " + text);
  }

  const name = basename(tsxPath, ".tsx");
  const tempPath = resolve("src/patcher", `.${name}-templates.tsx`);
  writeFileSync(tempPath, tempLines.join("\n"));

  const fnHtml: Record<string, string> = {};
  const varHtml: Record<string, string> = {};

  try {
    delete require.cache[tempPath];

    const mod = require(tempPath);

    // 4. Evaluate and minify function templates
    for (const fn of templateFns) {
      const fnName = fn.getName()!;
      fnHtml[fnName] = await minifyHtml(mod[`__${fnName}`]);
    }

    // 5. Evaluate and minify const templates
    for (const decl of templateVars) {
      varHtml[decl.getName()] = await minifyHtml(mod[decl.getName()]);
    }
  } finally {
    unlinkSync(tempPath);
  }

  return { tsxPath, source, templateFns, templateVars, depStmts, fnHtml, varHtml };
}

/**
 * Generates a .ts file from an evaluated .tsx module.
 *
 * Phase B: applies shortening map to minified HTML, splits on slot markers,
 * builds string-concat expressions, and writes the .ts output.
 */
function generateTsModule(
  evaluated: Awaited<ReturnType<typeof evaluateTsxModule>>,
  map: ShorteningMap,
) {
  const { tsxPath, source, templateFns, templateVars, depStmts, fnHtml, varHtml } = evaluated;

  // 1. Apply shortening + compile function templates
  for (const fn of templateFns) {
    const fnName = fn.getName()!;
    const html = applyShorteningMap(fnHtml[fnName], map);
    const { segments, slotNames } = splitFragment(fnName, html);

    let expr = JSON.stringify(segments[0]);
    for (let i = 0; i < slotNames.length; i++) {
      expr += ` + ${slotNames[i]} + ${JSON.stringify(segments[i + 1])}`;
    }

    fn.setBodyText(`return ${expr};`);
  }

  // 2. Apply shortening + compile const templates
  for (const decl of templateVars) {
    const html = applyShorteningMap(varHtml[decl.getName()], map);
    decl.setInitializer(JSON.stringify(html));
  }

  // 3. Remove dependency-only variable statements (consumed at build time)
  for (const stmt of depStmts) {
    stmt.remove();
  }

  // 4. Remove JSX imports + pragmas
  source
    .getImportDeclarations()
    .filter((imp) => imp.getModuleSpecifierValue().includes("/jsx"))
    .forEach((imp) => imp.remove());

  let output = source.getFullText();
  output = output.replace(/\/\*\*\s*@jsx\s+\w+\s*\*\/\s*\n?/g, "");
  output = output.replace(/\/\*\*\s*@jsxFrag\s+\w+\s*\*\/\s*\n?/g, "");

  writeFileSync(tsxPath.replace(/\.tsx$/, ".ts"), output);
}

/**
 * Compiles all .tsx files in src/patcher/ to .ts by evaluating JSX at build time.
 *
 * Two-phase approach:
 * - Phase A: evaluate all modules, collect minified HTML
 * - Build shortening map from combined HTML
 * - Phase B: apply map + generate .ts for each module
 */
async function compileTsxModules() {
  // Phase A: evaluate all .tsx modules and collect minified HTML
  const evaluated = [];

  for (const tsxPath of TSX_SOURCES) {
    evaluated.push(await evaluateTsxModule(tsxPath));
  }

  // Build shortening map from all combined HTML
  const allHtml = evaluated
    .flatMap((e) => [...Object.values(e.fnHtml), ...Object.values(e.varHtml)])
    .join("");
  const map = buildShorteningMap(allHtml);

  // Phase B: apply shortening map and generate .ts files
  for (const mod of evaluated) {
    generateTsModule(mod, map);
  }
}

function reportDiagnostics(diagnostics: readonly Diagnostic[]) {
  let hasErrors = false;

  for (const diagnostic of diagnostics) {
    // TSTL warns about luaBundle + inline but it's harmless
    if (String(diagnostic.messageText).includes("luaBundle")) {
      continue;
    }

    const msg = String(diagnostic.messageText);

    if (diagnostic.category === 0) {
      console.error("error:", msg);
      hasErrors = true;
    } else if (diagnostic.category === 1) {
      console.warn("warning:", msg);
    }
  }

  return hasErrors;
}

async function build() {
  let hasErrors = false;

  // Step 1: Generate constant declarations + compile JSX templates
  const comments = getConstantComments();

  generateConstantDeclarations(comments);
  await compileTsxModules();

  // Step 2: Patcher bundle
  const patcherResult = tstl.transpileProject("tsconfig.app.json", {
    noHeader: true,
    luaBundle: "patcher.slua",
    luaBundleEntry: resolve("src/patcher/index.ts"),
  });

  if (reportDiagnostics(patcherResult.diagnostics)) {
    hasErrors = true;
  }

  // Bootstrap standalone
  const bootstrapResult = tstl.transpileFiles(
    [resolve("src/types/globals.d.ts"), resolve("src/bootstrap.ts")],
    {
      rootDir: resolve("src"),
      outDir: resolve("dist"),
      target: 99, // ESNext
      module: 99, // ESNext
      strict: true,
      moduleDetection: 3, // Force
      skipLibCheck: true,
      types: ["@typescript-to-lua/language-extensions", "@gwigz/slua-types"],
      luaTarget: tstl.LuaTarget.Luau,
      luaLibImport: tstl.LuaLibImportKind.Inline,
      extension: "slua",
      noHeader: true,
      luaPlugins: [{ name: "@gwigz/slua-tstl-plugin" }],
    } as tstl.CompilerOptions,
  );

  if (reportDiagnostics(bootstrapResult.diagnostics)) {
    hasErrors = true;
  }

  if (hasErrors) {
    return false;
  }

  // Step 3: Inject constants at top of both .slua files
  injectConstants(resolve("dist/patcher.slua"), "src/patcher/index.ts", comments);
  injectConstants(resolve("dist/bootstrap.slua"), "src/bootstrap.ts", comments);

  // Step 4: Clean up generated .ts files so the editor resolves to .tsx sources
  for (const tsxPath of TSX_SOURCES) {
    unlinkSync(tsxPath.replace(/\.tsx$/, ".ts"));
  }

  console.log("Built dist/patcher.slua + dist/bootstrap.slua");

  return true;
}

await build();

if (WATCH) {
  console.log("Watching src/ for changes...");

  watch(resolve("src"), { recursive: true }, (_event: string, filename: string | null) => {
    if (
      filename &&
      (filename.endsWith(".ts") || filename.endsWith(".tsx")) &&
      !GENERATED_FILES.some((f: string) => filename.endsWith(f))
    ) {
      console.log(`\nChanged: ${filename}`);
      build();
    }
  });
}
