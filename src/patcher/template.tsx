/** Build-time page templates. Produces HTML strings embedded into the Lua bundle. */

/** Minimal DOM element subset for typechecking Alpine component code. */
interface AlpineElement {
  checked: boolean;
  indeterminate: boolean;
  value: string;
  open: boolean;
  textContent: string;
  closest(selector: string): AlpineElement;
  querySelectorAll(selector: string): AlpineElement[];
  querySelector(selector: string): AlpineElement;
}

/** Patcher Alpine.js component: state, computed properties, and methods. */
interface PatcherComponent {
  $root: AlpineElement;
  items: string[];
  allChecked: boolean;
  toggleAll(): void;
  toggleObject(objName: string): void;
  updateObjBoxes(): void;
  sync(): void;
}

/** Alpine component factory: serialized at build time via .toString(). */
const patcherData = function () {
  return {
    items: [] as string[],
    allChecked: false,
    toggleAll(this: PatcherComponent) {
      const boxes = [...this.$root.querySelectorAll("input[name=item]")];
      const objBoxes = [...this.$root.querySelectorAll(".obj-header input[type=checkbox]")];
      const details = [...this.$root.querySelectorAll("details")];

      if (this.allChecked) {
        this.items = [];

        boxes.forEach((b) => (b.checked = false));
        objBoxes.forEach((b) => (b.checked = false));
        details.forEach((d) => (d.open = false));
      } else {
        this.items = boxes.map((b) => {
          b.checked = true;
          return b.value;
        });

        objBoxes.forEach((b) => (b.checked = true));
        details.forEach((d) => (d.open = true));
      }

      this.allChecked = !this.allChecked;
    },
    toggleObject(this: PatcherComponent, objName: string) {
      const group = [...this.$root.querySelectorAll(".obj-group")].find(
        (g) => g.querySelector(".obj-name").textContent === objName,
      );

      if (!group) return;

      const boxes = [...group.querySelectorAll("input[name=item]")];
      const allChecked = boxes.every((b) => b.checked);

      boxes.forEach((b) => (b.checked = !allChecked));
      group.open = true;

      this.sync();
    },
    updateObjBoxes(this: PatcherComponent) {
      this.$root.querySelectorAll(".obj-header input[type=checkbox]").forEach((b) => {
        const group = b.closest(".obj-group");
        const boxes = [...group.querySelectorAll("input[name=item]")];
        const selected = boxes.filter((c) => c.checked).length;
        const total = boxes.length;

        b.checked = total > 0 && selected === total;
        b.indeterminate = selected > 0 && selected < total;
      });
    },
    sync(this: PatcherComponent) {
      this.items = [...this.$root.querySelectorAll("input[name=item]:checked")].map((b) => b.value);

      const allBoxes = this.$root.querySelectorAll("input[name=item]");

      this.allChecked = this.items.length > 0 && this.items.length === allBoxes.length;
      this.updateObjBoxes();
    },
  };
};

export function pageShell(baseUrl: string, objectName: string) {
  return (
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en" data-theme="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <base href={baseUrl + "/"} />
        <title>{objectName}</title>
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='1em'>📝</text></svg>"
        />
        <link
          rel="stylesheet"
          href="//cdn.jsdelivr.net/gh/fordus/shadcn-classless@main/dist/shadcn-classless.css"
        />
        <script src="//cdn.jsdelivr.net/npm/htmx.org@2/dist/htmx.min.js"></script>
        <script>
          {`/*<![CDATA[*/document.addEventListener('alpine:init',()=>{Alpine.data('patcher',${patcherData.toString()})})/*]]>*/`}
        </script>
        <script src="//cdn.jsdelivr.net/npm/lucide@0.460/dist/umd/lucide.min.js"></script>
        <style>
          {`
            b { font-weight: inherit; }
            body { max-width: 580px; padding: 1.5rem 1rem; }
            input[type="checkbox"] { margin: 0; flex-shrink: 0; }
            h2 { margin: 0 0 1rem; }

            .toolbar, .obj-header, .panel-body, .item-row {
              display: flex;
              align-items: center;
              gap: 0.5rem;
            }
            .toolbar label, .panel-body label {
              display: flex;
              align-items: center;
              gap: 0.4rem;
              margin: 0;
              cursor: pointer;
              color: var(--muted-foreground);
            }
            .toolbar label { font-size: 0.8rem; }
            .toolbar {
              flex-wrap: wrap;
              margin-bottom: 0.75rem;
            }
            .toolbar button, .toolbar [type="submit"] {
              font-size: 0.75rem;
              padding: 0.4rem 0.75rem;
              margin: 0;
              white-space: nowrap;
            }
            .toolbar svg { width: 14px; height: 14px; vertical-align: -2px; }

            .obj-list { margin-bottom: 1rem; }
            .obj-group { background: var(--card); }
            details { padding: 0; overflow: hidden; }
            summary { list-style: none; }
            summary::marker { display: none; content: none; }
            summary::-webkit-details-marker { display: none; }

            .obj-header {
              padding: 0.6rem 0.75rem;
              user-select: none;
            }
            .obj-header:hover { background: var(--accent); }
            .truncate {
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .obj-name, .item-name { flex: 1; }
            .obj-name { font-size: 0.85rem; font-weight: 600; }
            .obj-toggle {
              color: var(--muted-foreground);
              font-size: 0.7rem;
              flex-shrink: 0;
              width: 1rem;
              text-align: center;
              transition: transform 0.15s;
            }
            details[open] > summary .obj-toggle { transform: rotate(90deg); }

            kbd {
              font-size: 0.65rem;
              font-weight: 600;
              text-transform: uppercase;
            }

            .obj-items {
              border-top: var(--border);
              background: var(--secondary);
            }
            .item-row {
              padding: 0.35rem 0.75rem 0.35rem 2.25rem;
              font-size: 0.78rem;
              border-bottom: var(--border);
            }
            .item-row:last-child { border-bottom: none; }

            .empty-state { text-align: center; padding: 2rem 1rem; color: var(--muted-foreground); }

            #status { font-size: 0.8rem; flex-direction: column; align-items: stretch; }
            #status > b { font-weight: 600; }
.status-log {
              margin-top: 0.5rem;
              max-height: 160px;
              overflow-y: auto;
            }
            .status-log p {
              margin: 0;
              padding: 0.1rem 0;
              color: var(--muted-foreground);
              font-size: 0.7rem;
              font-family: ui-monospace, monospace;
              line-height: 1.3;
            }
            .status-log p:last-child { color: var(--foreground); }

            .panel {
              margin-bottom: 0.75rem;
              background: var(--card);
              padding: 0;
              overflow: hidden;
            }
            .panel-header {
              font-size: 0.7rem;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: var(--muted-foreground);
              padding: 0.4rem 0.75rem;
              border-bottom: var(--border);
            }
            .panel-body {
              font-size: 0.8rem;
              padding: 0.5rem 0.75rem;
            }
            .debounce-label {
              margin-left: auto !important;
            }
            .debounce-label input[type="number"] {
              width: 3.5rem;
              font-size: 0.75rem;
              padding: 0.2rem 0.4rem;
              margin: 0;
              text-align: center;
              border: var(--border);
              border-radius: var(--radius);
              background: var(--background);
              color: var(--foreground);
            }
          `}
        </style>
      </head>
      <body>
        <main hx-get="app" hx-trigger="load">
          <article aria-busy="spinner" style="text-align: center;"></article>
        </main>
        <script>{`/*<![CDATA[*/document.addEventListener('htmx:load',(e)=>{lucide.createIcons();if(window.Alpine)Alpine.initTree(e.target)})/*]]>*/`}</script>
        <script defer src="//cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
      </body>
    </html>
  );
}

export function appFragment(objectName: string) {
  return (
    <Fragment>
      <h2>{objectName}</h2>
      <hr />

      <form x-data="patcher">
        <div class="toolbar">
          <label>
            <input
              type="checkbox"
              {...{ "x-bind:checked": "allChecked", "x-on:click": "toggleAll()" }}
            />{" "}
            All
          </label>
          <b style="flex:1"></b>
          <button
            type="submit"
            hx-post="patch"
            hx-target="#status"
            x-show="items.length"
            {...{ "x-bind:disabled": "items.length === 0" }}
          >
            <i data-lucide="play"></i> Patch
          </button>
          <button type="button" hx-post="patch-all" hx-target="#status">
            <i data-lucide="layers"></i> Patch All
          </button>
          <button type="button" class="secondary" hx-get="objects" hx-target="#objects">
            <i data-lucide="refresh-cw"></i>
          </button>
        </div>

        <div
          id="objects"
          hx-get="objects"
          hx-trigger="load"
          {...{ "x-on:change": "sync()", "x-on:htmx:after-swap.camel": "sync()" }}
        >
          <article aria-busy="spinner" style="text-align: center;"></article>
        </div>
      </form>

      <div id="autoupdate" hx-get="autoupdate" hx-trigger="load" />

      <article class="panel">
        <div class="panel-header">Status</div>
        <div id="status" class="panel-body">
          Ready
        </div>
      </article>
    </Fragment>
  );
}
