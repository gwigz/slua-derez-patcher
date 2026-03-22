# SLua TSTL Project

TypeScript project that transpiles to Luau for Second Life's SLua runtime using TypeScriptToLua with `@gwigz/slua-tstl-plugin`.

## Commands

- `bun run build` compile templates + TypeScript to Luau via `tstl`
- `bun run dev` watch mode
- `bun run lint` lint with oxlint
- `bun run lint:fix` lint and auto-fix
- `bun run fmt` format with oxfmt
- `bun run fmt:check` check formatting

## Build Pipeline

1. `build.ts` uses `@gwigz/jsx-inline` to compile `.tsx` templates in `src/patcher/` into minified HTML string constants (`.tsx` → `.ts`, auto-generated, gitignored)
2. TSTL bundles `src/patcher/` (including generated `.ts` files) into `dist/patcher.slua`, with `@gwigz/tstl-bundle-flatten` for export elimination
3. Bootstrap compiles independently to `dist/bootstrap.slua`
4. Constants from `src/constants.ts` are injected at the top of both `.slua` files, and StyLua formats the output

`.tsx` files in `src/patcher/` are **build-time only** (compiled by Bun into `.ts` before TSTL runs). `.ts` files in `src/patcher/` are **runtime** (compiled to Luau by TSTL).

### HTML Templates

In `.tsx` templates, use `<b>` instead of `<span>` for inline non-semantic wrappers (badges, dots, spacers, labels). `<b>` is 4 bytes shorter per element than `<span>` (both open and close tags), which adds up in the minified HTML strings that `@gwigz/jsx-inline` embeds in the Lua bundle. A global `b { font-weight: inherit; }` reset neutralizes the bold default so `<b>` behaves like `<span>`.

## Writing TypeScript for SLua

Source files go in `src/patcher/`. The plugin transpiles standard TypeScript patterns into native SLua/Luau equivalents automatically.

### Event System

Use the typed `LLEvents` API:

```ts
LLEvents.on("touch_start", (events) => {
  for (const event of events) {
    ll.Say(0, event.getName());
  }
});

LLEvents.on("listen", (channel, name, id, message) => { ... });
```

Use `LLTimers` instead of `ll.SetTimerEvent`:

```ts
LLTimers.every(5.0, (scheduled, interval) => { ... });
LLTimers.once(2.0, (scheduled) => { ... });
```

### Auto-Transformed Patterns

Write standard TypeScript. The plugin rewrites these idioms to optimized Luau automatically:

- `JSON.stringify(v)` / `JSON.parse(s)` - `lljson.encode` / `lljson.decode`
- `btoa(s)` / `atob(s)` - `llbase64.encode` / `llbase64.decode`
- `str.toUpperCase()` / `str.toLowerCase()` - `ll.ToUpper` / `ll.ToLower`
- `str.trim()` - `ll.StringTrim`
- `str.indexOf(x)` - `ll.SubStringIndex`
- `str.includes(x)` / `str.startsWith(x)` - `string.find` patterns
- `str.split(sep)` - `string.split`
- `str.repeat(n)` - `string.rep`
- `str.replaceAll(a, b)` - `ll.ReplaceSubString`
- `str.substring(s, e)` - `string.sub` (auto-adjusts to 1-based indexing)
- `arr.includes(v)` / `arr.indexOf(v)` - `table.find` patterns
- `Math.floor(a / b)` - `a // b` (integer division)
- `a & b`, `a | b`, etc. - `bit32.band`, `bit32.bor`, etc.
- `(a & b) !== 0` - `bit32.btest`

### Core Types

- **`Vector`** 3D vector with `x`, `y`, `z`. Supports `+`, `-`, `*`, `/` via operator overloads. Create with `new Vector(x, y, z)`. Utilities on `Vector.magnitude()`, `Vector.normalize()`, `Vector.dot()`, `Vector.cross()`, `Vector.lerp()`, etc. Constants: `Vector.zero`, `Vector.one`.
- **`Quaternion`** (alias `rotation`) rotation with `x`, `y`, `z`, `s`. Create with `new Quaternion(x, y, z, s)`. Utilities on `Quaternion.normalize()`, `Quaternion.slerp()`, `Quaternion.tofwd()`, etc. Constant: `Quaternion.identity`.
- **`UUID`** 128-bit identifier. Create with `new UUID(str)`. Has `.istruthy` (not null key) and `.bytes`.
- **`list`** `(string | number | vector | uuid | quaternion | boolean)[]`
- **`DetectedEvent`** passed in touch/collision/sensor events. Methods: `getKey()`, `getName()`, `getOwner()`, `getPos()`, `getRot()`, `getVel()`, `getTouchST()`, `getTouchUV()`, `getTouchFace()`, `getLinkNumber()`, etc.

### SLua-Specific Globals

- `ll.*` all LSL functions (400+), e.g. `ll.Say()`, `ll.GetPos()`, `ll.SetTimerEvent()`, `ll.HTTPRequest()`
- `LLEvents` typed event registration (`on`, `off`, `once`, `listeners`, `eventNames`)
- `LLTimers` timer management (`every`, `once`, `off`)
- `lljson` JSON with SL-typed variants (`lljson.slencode()`, `lljson.sldecode()`)
- `llbase64` base64 encoding/decoding
- Type conversion: `touuid()`, `tovector()`, `toquaternion()`
- Constants: `ZERO_VECTOR`, `ZERO_ROTATION`, `NULL_KEY`, `PI`, and all `PRIM_*`, `PERMISSION_*`, `CHANGED_*`, `INVENTORY_*`, etc.

### Available Luau Libraries

`math`, `string`, `table`, `bit32`, `buffer`, `coroutine`, `utf8`, `os`, `debug` all available as typed namespaces.

### Things to Avoid

- No `Map`/`Set`/`WeakMap` use plain tables or arrays
- No `Object.keys()`/`Object.entries()` iterate with `for (const key in obj)` which compiles to `for key in pairs(obj)`. Do **not** use `for...of pairs()`, it compiles incorrectly.
- No `delete` operator set to `nil` instead
- No `async`/`await` use coroutines if needed
- No DOM or Node.js APIs this targets SLua, not a browser or server
- Don't use `console.log` use `ll.OwnerSay()` or `print()` for debug output
