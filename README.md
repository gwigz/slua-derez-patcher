# SLua Derez Patcher

A hot-patching system for Second Life's SLua runtime, designed to simplify development on products that rez or attach items. Instead of manually updating scripts and inventory across multiple objects, a single "patcher" prim holds everything and pushes changes on command.

It rezzes objects, transfers scripts via `ll.RemoteLoadScriptPin` and other inventory (notecards, textures, sounds, etc.) via `ll.GiveInventory`, then derezes it back -- updating the object in-place.

Built with [TypeScriptToLua](https://typescripttolua.github.io/) and [`@gwigz/slua-tstl-plugin`](https://github.com/gwigz/slua).

## Scripts

### `dist/patcher.slua` - goes in the patcher prim

Listens on channel `/7` for owner commands:

- `/7 patch lantern.obj` patch a single object
- `/7 patch all` patch every object with matching scripts
- `/7 list` list patchable objects and their scripts/items

### `dist/bootstrap.slua` - add to each patchable object

Enables remote script loading. On rez by the patcher, sets the access pin and signals readiness back when done. Tweak to suit your workflow, i.e. if there's data you need to load from notecards: only state ready once you're actually ready.

## Inventory Layout

Items named `ObjectName/item-name` target that specific object. This works for scripts, notecards, textures, sounds, animations, and any other inventory type. Wrap the prefix in `{...}` for pattern matching.

| Item Name                             | Matches                                  |
| ------------------------------------- | ---------------------------------------- |
| `lantern.obj/vfx.slua`                | `lantern.obj` only (script)              |
| `lantern.obj/config`                  | `lantern.obj` only (notecard)            |
| `{*}/utilities.slua`                  | every object                             |
| `{fire-*.obj}/embers.slua`            | `fire-pit.obj`, `fire-torch.obj`, etc.   |
| `{*-light.obj}/dim.slua`              | `desk-light.obj`, `wall-light.obj`, etc. |
| `{lantern.obj,campfire.obj}/vfx.slua` | `lantern.obj` and `campfire.obj`         |

Extensions and casing are purely convention -- the matching is on the full inventory name before the `/`. Objects and the patcher script itself are always excluded from matching.

## How It Works

1. Owner says `/7 patch lantern.obj`
2. Patcher scans inventory for scripts and items matching `lantern.obj/*` and `{pattern}/*`
3. Rezzes `lantern.obj` at the patcher's position
4. Bootstrap in the object sets the remote script access pin, signals `pinned`
5. Transfers non-script items (notecards, textures, etc.) via `ll.GiveInventory` (instant)
6. Transfers scripts via `ll.RemoteLoadScriptPin` (3s forced delay each)
7. Patcher signals `done`, bootstrap responds `ready`
8. Patcher derezes the object back to inventory

## Project Structure

```
├── build.ts                  Programmatic TSTL build script
├── src/
│   ├── bootstrap.ts          Standalone bootstrap script
│   └── patcher/
│       ├── index.ts          Entry point, state management, patch flow
│       ├── commands.ts       Command handlers (patch, list)
│       ├── inventory.ts      Pattern matching and inventory queries
│       └── effects.ts        Status text and particle effects
└── dist/                     Compiled output (gitignored)
    ├── patcher.slua          Bundled patcher script
    └── bootstrap.slua        Standalone bootstrap script
```

The patcher source is split across multiple files and bundled into a single `patcher.slua` using TSTL's `luaBundle`. Bootstrap compiles independently since it runs in a separate object.

## Setup

```sh
bun install
bun run build
```

## Development

```sh
bun run dev        # watch mode
bun run lint       # lint with oxlint
bun run lint:fix   # lint and auto-fix
bun run fmt        # format with oxfmt
bun run fmt:check  # check formatting
```
