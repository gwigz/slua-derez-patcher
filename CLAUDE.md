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

1. `build.ts` compiles JSX templates (`src/web/template.tsx`) into minified HTML string constants, writes `src/patcher/template.ts` (auto-generated, gitignored)
2. TSTL bundles `src/patcher/` (including generated `template.ts`) into `dist/patcher.slua`
3. Bootstrap compiles independently to `dist/bootstrap.slua`

`src/web/` files are **build-time only** (run in Bun, never compiled by TSTL). `src/patcher/` files are **runtime** (compiled to Luau by TSTL). Do not put JSX/TSX files in `src/patcher/`.

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

The plugin rewrites these TypeScript idioms into optimized Luau:

| TypeScript              | Compiles to                                 |
| ----------------------- | ------------------------------------------- |
| `JSON.stringify(v)`     | `lljson.encode(v)`                          |
| `JSON.parse(s)`         | `lljson.decode(s)`                          |
| `btoa(s)` / `atob(s)`   | `llbase64.encode(s)` / `llbase64.decode(s)` |
| `str.toUpperCase()`     | `ll.ToUpper(str)`                           |
| `str.toLowerCase()`     | `ll.ToLower(str)`                           |
| `str.trim()`            | `ll.StringTrim(str, STRING_TRIM)`           |
| `str.indexOf(x)`        | `ll.SubStringIndex(str, x)`                 |
| `str.includes(x)`       | `string.find(str, x, 1, true) ~= nil`       |
| `str.startsWith(x)`     | `string.find(str, x, 1, true) == 1`         |
| `str.split(sep)`        | `string.split(str, sep)`                    |
| `str.repeat(n)`         | `string.rep(str, n)`                        |
| `str.substring(s, e)`   | `string.sub(str, s + 1, e)`                 |
| `arr.includes(v)`       | `table.find(arr, v) ~= nil`                 |
| `arr.indexOf(v)`        | `(table.find(arr, v) or 0) - 1`             |
| `Math.floor(a / b)`     | `a // b`                                    |
| `a & b`, `a \| b`, etc. | `bit32.band(a, b)`, `bit32.bor(a, b)`, etc. |
| `(a & b) !== 0`         | `bit32.btest(a, b)`                         |

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

### TSTL Pitfalls

- **`ll.*` index parameters are 1-based.** SLua follows Lua convention, not LSL's 0-based indexing. Use `for (let i = 1; i <= count; i++)` when calling `ll.GetInventoryName`, `ll.GetLinkName`, etc.
- **Don't use `continue` in `for` loops.** TSTL compiles `for` to `while` loops in Luau. `continue` in a `while` loop skips the increment (`i++`), causing an infinite loop. Use nested `if` blocks instead.
- **`tonumber()` inserts a spurious `nil` self arg.** The `@gwigz/slua-types` declaration for `tonumber` lacks `@noSelf`, so TSTL compiles `tonumber(hex, 16)` as `tonumber(nil, hex, 16)`. Avoid calling `tonumber` directly; use manual byte arithmetic or other workarounds.
- **No `string.replaceAll` in Luau.** Use `str.split(old).join(new)` which compiles to `table.concat(string.split(...), ...)`.
- **`string.gsub` callbacks get a `self` parameter.** TSTL adds `self` to callback functions passed to `string.gsub`. Use `this: void` or `@noSelf` on the callback, or avoid callbacks entirely.

### Things to Avoid

- No `Map`/`Set`/`WeakMap` use plain tables or arrays
- No `Object.keys()`/`Object.entries()` use `pairs()` or `ipairs()`
- No `delete` operator set to `nil` instead
- No `async`/`await` use coroutines if needed
- No DOM or Node.js APIs this targets SLua, not a browser or server
- Don't use `console.log` use `ll.OwnerSay()` or `print()` for debug output
