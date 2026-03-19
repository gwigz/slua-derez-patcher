/** @jsx h */
/** @jsxFrag Fragment */

/** Build-time page templates. Produces HTML strings embedded into the Lua bundle. */
import { h, Fragment } from "./jsx";

export function PageShell() {
  return (
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en" data-theme="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <base href="%BASE_URL%/" />
        <title>Patcher</title>
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>"
        />
        <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
        <script src="//cdn.jsdelivr.net/npm/htmx.org@2/dist/htmx.min.js"></script>
        <script defer src="//cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
        <script src="//cdn.jsdelivr.net/npm/lucide@0.460/dist/umd/lucide.min.js"></script>
        <style>
          {`
            body > main {
              max-width: 580px;
              margin: 0 auto;
              padding: 1.5rem 1rem;
            }

            .app-header {
              font-size: 1.25rem;
              margin: 0 0 1rem;
              padding-bottom: 0.75rem;
              border-bottom: 1px solid var(--pico-muted-border-color);
              letter-spacing: -0.02em;
            }

            /* Toolbar */
            .toolbar {
              display: flex;
              gap: 0.5rem;
              align-items: center;
              flex-wrap: wrap;
              margin-bottom: 0.75rem;
            }
            .toolbar label {
              font-size: 0.8rem;
              color: var(--pico-muted-color);
              display: flex;
              align-items: center;
              gap: 0.4rem;
              margin: 0;
              cursor: pointer;
            }
            .toolbar label input[type="checkbox"] { margin: 0; }
            .toolbar-spacer { flex: 1; }
            .toolbar button, .toolbar [type="submit"] {
              width: auto;
              font-size: 0.75rem;
              font-weight: 500;
              padding: 0.4rem 0.75rem;
              margin: 0;
              white-space: nowrap;
            }
            .toolbar svg { width: 14px; height: 14px; vertical-align: -2px; }

            /* Object list */
            .obj-list {
              display: flex;
              flex-direction: column;
              gap: 1px;
              background: var(--pico-muted-border-color);
              border: 1px solid var(--pico-muted-border-color);
              border-radius: var(--pico-border-radius);
              overflow: hidden;
              margin-bottom: 1rem;
            }
            .obj-group { background: var(--pico-card-background-color); }

            /* Summary/details reset */
            details { margin: 0; }
            details summary { list-style: none !important; padding: 0; }
            details summary::after { display: none !important; }
            details summary::-webkit-details-marker { display: none !important; }
            details summary::marker { display: none !important; content: none !important; }
            details[open] > summary { margin-bottom: 0 !important; }

            .obj-header {
              display: flex;
              align-items: center;
              gap: 0.5rem;
              padding: 0.6rem 0.75rem;
              cursor: pointer;
              user-select: none;
            }
            .obj-header:hover { background: var(--pico-card-sectioning-background-color); }
            .obj-header input[type="checkbox"] { margin: 0; flex-shrink: 0; }
            .truncate {
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .obj-name { font-size: 0.85rem; font-weight: 600; flex: 1; }
            .obj-badge {
              font-size: 0.65rem;
              color: var(--pico-muted-color);
              background: var(--pico-card-sectioning-background-color);
              padding: 0.1rem 0.4rem;
              border-radius: 3px;
              flex-shrink: 0;
            }
            .obj-toggle {
              color: var(--pico-muted-color);
              font-size: 0.7rem;
              flex-shrink: 0;
              width: 1rem;
              text-align: center;
              transition: transform 0.15s;
            }
            details[open] > summary .obj-toggle { transform: rotate(90deg); }

            /* Item rows */
            .obj-items {
              border-top: 1px solid var(--pico-muted-border-color);
              background: var(--pico-card-sectioning-background-color);
            }
            .item-row {
              display: flex;
              align-items: center;
              gap: 0.5rem;
              padding: 0.35rem 0.75rem 0.35rem 2.25rem;
              font-size: 0.78rem;
              color: var(--pico-muted-color);
              border-bottom: 1px solid var(--pico-muted-border-color);
            }
            .item-row:last-child { border-bottom: none; }
            .item-row input[type="checkbox"] { margin: 0; flex-shrink: 0; }
            .item-row .item-name { flex: 1; }
            .item-type {
              font-size: 0.65rem;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              flex-shrink: 0;
              padding: 0.05rem 0.3rem;
              border-radius: 3px;
            }
            .item-type-script { color: var(--pico-primary); background: var(--pico-primary-focus); }
            .item-type-item { color: var(--pico-muted-color); background: var(--pico-card-sectioning-background-color); }

            .empty-state { text-align: center; padding: 2rem 1rem; color: var(--pico-muted-color); }

            /* Status */
            #status { font-size: 0.8rem; }
            #status progress { margin-top: 0.5rem; }
            .status-header { display: flex; align-items: center; gap: 0.5rem; }
            .status-dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              flex-shrink: 0;
            }
            .status-dot-ready { background: var(--pico-primary); }
            .status-dot-busy {
              background: #d29922;
              animation: pulse 1.5s ease-in-out infinite;
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
            .status-log {
              margin-top: 0.5rem;
              max-height: 160px;
              overflow-y: auto;
            }
            .status-log p { margin: 0.1rem 0; color: var(--pico-muted-color); font-size: 0.75rem; }
            .status-log p:last-child { color: var(--pico-color); }
            .status-pct { font-size: 0.75rem; color: var(--pico-muted-color); margin-left: auto; }
          `}
        </style>
      </head>
      <body>
        <main hx-get="app" hx-trigger="load" hx-swap="innerHTML">
          <p aria-busy="true">Loading</p>
        </main>
        <script>{"document.addEventListener('htmx:load', () => lucide.createIcons())"}</script>
      </body>
    </html>
  );
}

const ALPINE_STATE = `{
  items: [],
  allChecked: false,
  get selectedCount() {
    return this.items.length;
  },
  toggleAll() {
    const boxes = [...$el.querySelectorAll('input[name=item]')];
    const objBoxes = [...$el.querySelectorAll('.obj-header input[type=checkbox]')];
    const details = [...$el.querySelectorAll('details')];
    if (this.allChecked) {
      this.items = [];
      boxes.forEach(b => b.checked = false);
      objBoxes.forEach(b => b.checked = false);
      details.forEach(d => d.open = false);
    } else {
      this.items = boxes.map(b => { b.checked = true; return b.value; });
      objBoxes.forEach(b => b.checked = true);
      details.forEach(d => d.open = true);
    }
    this.allChecked = !this.allChecked;
  },
  toggleObject(objName) {
    const boxes = [...$el.querySelectorAll('input[name=item]')]
      .filter(b => b.value.startsWith(objName + '/'));
    const allChecked = boxes.every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    const det = boxes[0] && boxes[0].closest('details');
    if (det) det.open = true;
    this.sync();
  },
  updateObjBoxes() {
    $el.querySelectorAll('.obj-header input[type=checkbox]').forEach(b => {
      const name = b.closest('.obj-group').querySelector('.obj-name').textContent;
      const prefix = name + '/';
      const selected = this.items.filter(i => i.startsWith(prefix)).length;
      const total = $el.querySelectorAll('input[name=item][value^="' + prefix + '"]').length;
      b.checked = total > 0 && selected === total;
      b.indeterminate = selected > 0 && selected < total;
    });
  },
  sync() {
    this.items = [...$el.querySelectorAll('input[name=item]:checked')].map(b => b.value);
    const allBoxes = $el.querySelectorAll('input[name=item]');
    this.allChecked = this.items.length > 0 && this.items.length === allBoxes.length;
    this.updateObjBoxes();
  }
}`;

export function AppFragment() {
  return (
    <Fragment>
      <h1 class="app-header">Patcher</h1>

      <form x-data={ALPINE_STATE}>
        <div class="toolbar">
          <label>
            <input
              type="checkbox"
              {...{ "x-bind:checked": "allChecked", "x-on:change": "toggleAll()" }}
            />{" "}
            All
          </label>
          <span class="toolbar-spacer"></span>
          <button
            type="submit"
            hx-post="patch"
            hx-target="#status"
            hx-swap="innerHTML"
            x-show="selectedCount > 0"
            {...{ "x-bind:disabled": "selectedCount === 0" }}
          >
            <i data-lucide="play"></i> Patch
          </button>
          <button type="button" hx-post="patch-all" hx-target="#status" hx-swap="innerHTML">
            <i data-lucide="layers"></i> Patch All
          </button>
          <button
            type="button"
            class="secondary"
            hx-get="objects"
            hx-target="#objects"
            hx-swap="innerHTML"
          >
            <i data-lucide="refresh-cw"></i>
          </button>
        </div>

        <div
          id="objects"
          hx-get="objects"
          hx-trigger="load"
          hx-swap="innerHTML"
          {...{ "x-on:htmx:after-swap.camel": "sync()" }}
        >
          <p aria-busy="true">Scanning inventory</p>
        </div>
      </form>

      <article id="status">
        <div class="status-header">
          <span class="status-dot status-dot-ready"></span>
          <span>Ready</span>
        </div>
      </article>
    </Fragment>
  );
}
