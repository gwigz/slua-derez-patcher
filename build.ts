import type { Diagnostic } from "typescript";
import * as tstl from "typescript-to-lua";
import { watch } from "node:fs";
import { resolve } from "node:path";

const WATCH = process.argv.includes("--watch");

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

function build() {
  let hasErrors = false;

  // Patcher bundle
  const patcherResult = tstl.transpileProject("tsconfig.json", {
    luaBundle: "patcher.slua",
    luaBundleEntry: resolve("src/patcher/index.ts"),
  });

  if (reportDiagnostics(patcherResult.diagnostics)) {
    hasErrors = true;
  }

  // Bootstrap standalone
  const bootstrapResult = tstl.transpileFiles([resolve("src/bootstrap.ts")], {
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
    luaPlugins: [{ name: "@gwigz/slua-tstl-plugin" }],
  } as tstl.CompilerOptions);

  if (reportDiagnostics(bootstrapResult.diagnostics)) {
    hasErrors = true;
  }

  if (hasErrors) {
    return false;
  }

  console.log("Built dist/patcher.slua + dist/bootstrap.slua");

  return true;
}

build();

if (WATCH) {
  console.log("Watching src/ for changes...");

  watch(resolve("src"), { recursive: true }, (_event: string, filename: string | null) => {
    if (filename && filename.endsWith(".ts")) {
      console.log(`\nChanged: ${filename}`);
      build();
    }
  });
}
