import type { Diagnostic } from "typescript";
import * as tstl from "typescript-to-lua";
import { compile } from "@gwigz/jsx-inline";
import { watch, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, basename } from "node:path";

import * as constants from "./src/constants";

const WATCH = process.argv.includes("--watch");
const GENERATED_HEADER = "--[[ Generated with @gwigz/slua - https://github.com/gwigz/slua ]]";

/** All .tsx source files in src/patcher/ that compile to .ts at build time. */
const TSX_SOURCES = readdirSync(resolve("src/patcher"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => resolve("src/patcher", f));

/** Generated .ts files that should not trigger rebuilds in watch mode. */
const GENERATED_FILES = TSX_SOURCES.map((f) => "patcher/" + basename(f, ".tsx") + ".ts");

/** Extracts the leading JSDoc block from a source file and converts it to a Lua multiline comment. */
function extractFileComment(sourcePath: string) {
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

/** Prepends file header comment and constants to a compiled .slua file. */
function injectConstants(filePath: string, content: string, sourcePath: string, comments: Record<string, string>) {
  const header = extractFileComment(sourcePath);

  const lines = Object.entries(constants)
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(content))
    .map(([name, value]) => {
      const comment = comments[name];
      const luaValue = typeof value === "string" ? JSON.stringify(value) : String(value);
      return comment ? `--- ${comment}\nlocal ${name} = ${luaValue}` : `local ${name} = ${luaValue}`;
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

  await compile(TSX_SOURCES);

  // Step 2: Patcher bundle, and export elimination
  const patcherResult = tstl.transpileProject("tsconfig.patcher.json", {
    noHeader: true,
    luaBundle: "patcher.slua",
    luaBundleEntry: resolve("src/patcher/index.ts"),
  });

  if (reportDiagnostics(patcherResult.diagnostics)) {
    hasErrors = true;
  }

  const patcherPath = resolve("dist/patcher.slua");

  // Bootstrap standalone
  const bootstrapResult = tstl.transpileFiles([resolve("src/types/globals.d.ts"), resolve("src/bootstrap.ts")], {
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
    noImplicitSelf: true,
    luaPlugins: [{ name: "@gwigz/slua-tstl-plugin" }, { name: "@gwigz/tstl-bundle-flatten" }],
  } as tstl.CompilerOptions);

  if (reportDiagnostics(bootstrapResult.diagnostics)) {
    hasErrors = true;
  }

  const bootstrapPath = resolve("dist/bootstrap.slua");

  if (hasErrors) {
    return false;
  }

  // Step 3: Inject constants at top of both .slua files
  injectConstants(patcherPath, readFileSync(patcherPath, "utf8"), "src/patcher/index.ts", comments);
  injectConstants(bootstrapPath, readFileSync(bootstrapPath, "utf8"), "src/bootstrap.ts", comments);

  // Step 4: Format .slua output with StyLua
  try {
    execSync("npx stylua --verify -- dist/patcher.slua dist/bootstrap.slua");
  } catch (e: unknown) {
    console.warn("warning: stylua formatting failed");
    if (e instanceof Error && "stderr" in e) console.warn(String(e.stderr));
  }

  // Step 5: Clean up generated .ts files so the editor resolves to .tsx sources
  for (const tsxPath of TSX_SOURCES) {
    unlinkSync(tsxPath.replace(/\.tsx$/, ".ts"));
  }

  console.log("Built dist/patcher.slua + dist/bootstrap.slua");

  return true;
}

await build();

if (WATCH) {
  console.log("Watching src/ for changes...");

  let debounce: Timer | null = null;
  let building = false;
  let pending = false;

  watch(resolve("src"), { recursive: true }, (_event: string, filename: string | null) => {
    if (
      !filename ||
      !(filename.endsWith(".ts") || filename.endsWith(".tsx")) ||
      GENERATED_FILES.some((f: string) => filename.endsWith(f))
    ) {
      return;
    }

    if (debounce) {
      clearTimeout(debounce);
    }

    debounce = setTimeout(async () => {
      debounce = null;

      if (building) {
        pending = true;
        return;
      }

      building = true;

      try {
        do {
          pending = false;
          console.log(`\nRebuilding...`);
          await build();
        } while (pending);
      } catch (err) {
        console.error("Build failed:", err);
      } finally {
        building = false;
      }
    }, 100);
  });
}
