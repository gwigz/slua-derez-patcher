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

/** Disconnected page shown when the capability URL dies. Function (not const) so jsx-inline treats it as a templateFn evaluated before pageShell. */
function disconnectedHtml() {
  return (
    <article empty>
      <i data-lucide="wifi-off" color="destructive"></i>
      <h2>Disconnected</h2>
      <b>The connection has been lost, you can close this page</b>
    </article>
  );
}

/** HTMX lifecycle: re-init icons/Alpine after swaps, show disconnected state on cap error. */
const htmxInit = function (html: string) {
  const g = globalThis as any;

  document.addEventListener("htmx:load", (e: any) => {
    g.lucide.createIcons();
    if (g.Alpine) g.Alpine.initTree(e.target);
  });

  // One-shot: on first HTMX error, replace page with disconnected message
  function dc() {
    document.removeEventListener("htmx:sendError", dc);
    document.removeEventListener("htmx:responseError", dc);
    document.querySelector("main")!.innerHTML = html;
    g.lucide.createIcons();
  }

  document.addEventListener("htmx:sendError", dc);
  document.addEventListener("htmx:responseError", dc);
};

export function pageShell(baseUrl: string, objectName: string) {
  return (
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <base href={baseUrl + "/"} />
        <title>{objectName}</title>
        <link
          rel="icon"
          href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🧩</text></svg>'
        />
        <link rel="stylesheet" href="//unpkg.com/@gwigz/slick-css@1.0.0/dist/slick-static.min.css" />
        <script src="//unpkg.com/htmx.org@2.0.8/dist/htmx.min.js"></script>
        <script>
          {`/*<![CDATA[*/document.addEventListener('alpine:init',()=>{Alpine.data('patcher',${patcherData.toString()})})/*]]>*/`}
        </script>
        <script src="//unpkg.com/lucide@0.577/dist/umd/lucide.min.js"></script>
        <style>
          {`
            form { display: contents }
            .obj-group:last-child { border-bottom: none }
            .item-row { padding: 0.35rem 0.75rem 0.35rem 2.25rem }
            article > header { font-weight: 600 }
            #status { flex-direction: column; align-items: stretch }
          `}
        </style>
      </head>
      <body>
        <main sm hx-get="app" hx-trigger="load" stack>
          <article aria-busy="true" align="center"></article>
        </main>
        <script>{`/*<![CDATA[*/(${htmxInit.toString()})(${JSON.stringify(disconnectedHtml())})/*]]>*/`}</script>
        <script defer src="//unpkg.com/alpinejs@3.15.8/dist/cdn.min.js"></script>
      </body>
    </html>
  );
}

export function appFragment() {
  return (
    <Fragment>
      <form x-data="patcher">
        <div row>
          <label>
            <input type="checkbox" {...{ "x-bind:checked": "allChecked", "x-on:click": "toggleAll()" }} /> All
          </label>
          <b spacer></b>
          <button
            type="submit"
            sm
            hx-post="patch"
            hx-target="#status"
            x-show="items.length"
            {...{ "x-bind:disabled": "items.length === 0" }}
          >
            <i data-lucide="play"></i> Patch
          </button>
          <button type="button" sm hx-post="patch-all" hx-target="#status">
            <i data-lucide="layers"></i> Patch All
          </button>
          <button type="button" sm secondary hx-get="objects" hx-target="#objects">
            <i data-lucide="refresh-cw"></i>
          </button>
        </div>

        <article
          id="objects"
          flush
          hx-get="objects"
          hx-trigger="load"
          {...{ "x-on:change": "sync()", "x-on:htmx:after-swap.camel": "sync()" }}
        >
          <article aria-busy="true" align="center"></article>
        </article>
      </form>

      <div id="autoupdate" hx-get="autoupdate" hx-trigger="load" />

      <article flush>
        <header>Status</header>
        <div id="status" row>
          Ready
        </div>
      </article>

      <div align="center" x-data="{ confirmText: '' }">
        <button type="button" sm destructive {...{ "x-on:click": "$refs.fd.showModal()" }}>
          {"Remove patcher scripts\u2026"}
        </button>

        <dialog align="left" x-ref="fd">
          <header>
            <h3>Remove patcher scripts?</h3>
            <p>This will remove the bootstrap script from every target object, then delete the patcher script.</p>
          </header>
          <div stack="xs">
            <label for="confirmText">Type FINISH to confirm</label>
            <input type="text" id="confirmText" x-model="confirmText" placeholder="FINISH" autocomplete="off" />
          </div>
          <footer>
            <button type="button" secondary {...{ "x-on:click": "confirmText='';$refs.fd.close()" }}>
              Cancel
            </button>
            <button
              type="button"
              hx-post="finish"
              hx-target="#status"
              destructive
              {...{
                "x-bind:disabled": "confirmText.toUpperCase() !== 'FINISH'",
                "x-on:click": "confirmText='';$refs.fd.close()",
              }}
            >
              Confirm
            </button>
          </footer>
        </dialog>
      </div>
    </Fragment>
  );
}
