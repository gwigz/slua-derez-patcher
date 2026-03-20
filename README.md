# SLua Derez Patcher

Tired of the rez-edit-take-replace dance every time you update objects your scripts rez?

Throw it all in one prim, child scripts set to not running, and let [`ll.RemoteLoadScriptPin`](https://wiki.secondlife.com/wiki/LlRemoteLoadScriptPin), [`ll.GiveInventory`](https://wiki.secondlife.com/wiki/LlGiveInventory), and [`ll.DerezObject`](https://wiki.secondlife.com/wiki/LlDerezObject) handle the work instead.

Built with [TypeScriptToLua](https://typescripttolua.github.io/) and [`@gwigz/slua-tstl-plugin`](https://github.com/gwigz/slua).

<p align="center">
  <img src=".github/assets/ingame.webp" alt="Web UI and in-world patcher">
</p>

## Quick Start

1. Drop `dist/patcher.slua` into your main prim
2. Drop `dist/bootstrap.slua` into each object you want to patch
3. Name your scripts, sounds, animations, etc. using the `ObjectName/ItemName` naming convention
4. Drop those named scripts/items into the same prim as the patcher
5. The patcher prints an HTTP-in URL to owner chat on start -- open it in a browser
6. Select objects, click patch, and watch it go

## Scripts

### `dist/patcher.slua` - belongs in your main object

On script start, requests an HTTP-in URL and prints it to owner chat. Open the URL in a browser to access the web UI dashboard where you can:

- Browse objects and items
- Select individual items, or use "Select All"
- Patch selected objects or all at once
- Watch live progress via long polling

Chat command `/7 url` prints the HTTP-in URL again if needed.

### `dist/bootstrap.slua` - add to each rezable object

Enables remote script loading. On rez by the patcher, sets the access pin and signals readiness back when done. Tweak to suit your workflow, i.e. if there's data you need to load from notecards: only state ready once you're actually ready.

## Inventory Layout

Items named `Object Name/Item Name` target that specific object. This works for scripts, notecards, textures, sounds, animations, and any other inventory type. Wrap the prefix in `{...}` for pattern matching.

| Item Name                             | Matches                                  |
| ------------------------------------- | ---------------------------------------- |
| `lantern.obj/vfx.slua`                | `lantern.obj` only (script)              |
| `lantern.obj/config.ini`              | `lantern.obj` only (notecard)            |
| `{*}/utilities.slua`                  | every object                             |
| `{fire-*.obj}/embers.slua`            | `fire-pit.obj`, `fire-torch.obj`, etc.   |
| `{*-light.obj}/dim.slua`              | `desk-light.obj`, `wall-light.obj`, etc. |
| `{lantern.obj,campfire.obj}/vfx.slua` | `lantern.obj` and `campfire.obj`         |

Extensions and casing are purely convention -- the matching is on the full inventory name before the `/`. Objects and the patcher script itself are always excluded from matching.

## How It Works

For each selected object, the patcher rezzes it at its own position, waits for the bootstrap script to set a pin and signal back, pushes any inventory items and scripts, then derezes it back. The browser gets live progress updates via long polling.

```mermaid
sequenceDiagram
    participant User as Browser
    participant Patcher as Main Object
    participant Object as Rezzed Object

    User->>Patcher: Select objects, click patch
    Patcher->>Patcher: Scan inventory for matching scripts & items

    loop For each selected object
        Patcher->>Object: Rez object at patcher position
        Object->>Patcher: Set pin, signal pinned

        opt Has non-script items
            Patcher->>Object: ll.GiveInventory (instant)
        end

        loop For each script (3s delay each)
            Patcher->>Object: ll.RemoteLoadScriptPin
        end

        Patcher->>Object: Signal done
        Object->>Patcher: Signal ready
        Patcher->>Object: Derez back to inventory
        Patcher-->>User: Live progress update (long poll)
    end
```

Scripts have a 3 second delay between each load (`ll.RemoteLoadScriptPin` is throttled by the sim), but non-script inventory transfers via `ll.GiveInventory` are instant. The bootstrap script in each object handles the pin setup and signals readiness -- tweak it if your object needs time to initialize before being taken back.

## Project Structure

```
├── build.ts                  Build script (template compilation + TSTL)
├── src/
│   ├── bootstrap.ts          Standalone bootstrap script
│   ├── web/                  Build-time only (JSX → HTML strings)
│   │   ├── jsx.ts            Custom JSX factory: h() → string
│   │   ├── jsx.d.ts          JSX type declarations (with typed-htmx)
│   │   └── template.tsx      Page shell and app fragment templates
│   └── patcher/
│       ├── index.ts          Entry point, HTTP-in routing, state, patch flow
│       ├── http.ts           HTML fragment builders, form parser
│       ├── commands.ts       Command handlers (patch all)
│       ├── inventory.ts      Pattern matching and inventory queries
│       ├── effects.ts        Status text and particle effects
│       └── template.ts       Auto-generated HTML constants (gitignored)
└── dist/
    ├── patcher.slua          Bundled patcher script
    └── bootstrap.slua        Standalone bootstrap script
```

### Build Pipeline

```mermaid
flowchart TD
    A(src/web/template.tsx) -->|Bun require| B(build.ts)
    B -->|PageShell & AppFragment| C(HTML strings)
    C -->|minify-html| D(src/patcher/template.ts)
    D --> E(TSTL)
    F(src/patcher/*.ts) --> E
    G(src/bootstrap.ts) --> E
    E --> H(dist/patcher.slua)
    E --> I(dist/bootstrap.slua)
```

### Web UI Stack

The web UI is served entirely from SLua's HTTP-in (no external server):

```mermaid
graph TD
    SLua(SLua HTTP-in) -->|HTML fragments| Browser
    Browser --> CDN
    CDN --> HTMX(HTMX)
    CDN --> Alpine(Alpine.js)
    CDN --> Pico(Pico CSS)
    CDN --> Lucide(Lucide Icons)
```

The stack is deliberately minimal, everything the script serves has to fit in SLua's limited script memory.

[HTMX](https://htmx.org) fits perfectly: the server sends tiny HTML fragments instead of JSON, and the client swaps them in place with no build step or client-side routing. [Alpine.js](https://alpinejs.dev) covers the small amount of client state (checkbox toggles). [Pico CSS](https://picocss.com) gives a clean dark-mode look with zero classes, and [Lucide](https://lucide.dev) provides icons via `data-lucide` tags.

Everything loads from CDN so the SLua script never serves static assets.

### Routes

All routes are defined in the `http_request` event handler in `src/patcher/index.ts`.

| Method | Path         | Description                                   |
| ------ | ------------ | --------------------------------------------- |
| GET    | `/`          | Full page shell with base URL injected        |
| GET    | `/app`       | App fragment (object list + controls)         |
| GET    | `/objects`   | Object list with items and checkboxes         |
| GET    | `/poll`      | Long poll -- held open until status changes   |
| POST   | `/patch`     | Patch selected objects (form body with items) |
| POST   | `/patch-all` | Patch all objects at once                     |

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
