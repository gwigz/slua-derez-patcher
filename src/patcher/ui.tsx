import { getObjectNames, getItemsForObject, patternMatches, targetItemName, inventoryTypeLabel } from "./inventory";

const EMPTY_STATE = <div class="empty-state">No patchable objects found in inventory.</div>;

const STATUS_DONE = <b>Done</b>;

const POLL_TRIGGER = <div hx-get="poll" hx-trigger="load" hx-target="#status"></div>;

export const NO_ITEMS_SELECTED = <b>No items selected</b>;

// --- Runtime code (compiled by TSTL to Luau) ---

/** Escapes HTML special characters to prevent XSS. */
function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Builds an inventory row with a type-specific badge. */
function buildItemRow(fullItemName: string) {
  const typeLabel = inventoryTypeLabel(ll.GetInventoryType(fullItemName));
  const escaped = escapeHtml(fullItemName);
  const itemName = escapeHtml(targetItemName(fullItemName));

  return (
    <label class="item-row">
      <input type="checkbox" name="item" value={escaped} {...{ "x-on:change": "sync()" }} />
      <b class="item-name truncate" {...{ "tooltip-top": itemName }}>
        {itemName}
      </b>
      <kbd {...{ secondary: true }}>{typeLabel}</kbd>
    </label>
  );
}

/**
 * Builds the object list HTML with expandable groups and per-item checkboxes.
 * Each item checkbox has name="item" value="ObjectName/item-name".
 */
export function buildObjectList(selfName: string) {
  const objects = getObjectNames();
  let html = "";

  for (const obj of objects) {
    const { scripts, items } = getItemsForObject(selfName, obj);

    if (scripts.length > 0 || items.length > 0) {
      const escaped = escapeHtml(obj);
      let itemsHtml = "";

      for (const script of scripts) {
        itemsHtml += buildItemRow(script);
      }

      for (const item of items) {
        itemsHtml += buildItemRow(item);
      }

      html += (
        <details class="obj-group">
          <summary>
            <div class="obj-header">
              <b class="obj-toggle">{"&#9654;"}</b>
              <input
                type="checkbox"
                {...{
                  "x-on:click.stop": `toggleObject('${escaped}')`,
                }}
              />
              <b class="obj-name truncate" {...{ "tooltip-top": escaped }}>
                {escaped}
              </b>
            </div>
          </summary>
          <div class="obj-items">{itemsHtml}</div>
        </details>
      );
    }
  }

  if (html === "") {
    return EMPTY_STATE;
  }

  return html;
}

/**
 * Builds a status fragment showing current patch progress.
 * Includes an hx-get="poll" trigger to continue long polling while busy
 * or when autoupdate is enabled (so status updates push immediately).
 */
export function buildStatusFragment(busy: boolean, index: number, total: number, log: string[], autoUpdate = false) {
  let html = "";

  if (busy) {
    html += (
      <>
        <b>
          Patching {index}/{total}
        </b>
        <progress value={index} max={total}></progress>
      </>
    );
  } else if (total > 0) {
    html += (
      <>
        <b>Done</b>
        <progress value={total} max={total}></progress>
      </>
    );
  } else {
    html += STATUS_DONE;
  }

  if (log.length > 0) {
    let logHtml = "";

    for (const entry of log) {
      logHtml += <p>{escapeHtml(entry)}</p>;
    }

    html += <div class="status-log">{logHtml}</div>;
  }

  if (busy || autoUpdate) {
    html += POLL_TRIGGER;
  }

  return html;
}

/**
 * Decodes a single URL-encoded value (+ -> space, %XX -> char).
 * Collects parts into an array and joins once to avoid O(N²) string concat.
 */
function urlDecode(encoded: string) {
  let result = string.gsub(encoded, "+", " ")[0];

  const parts: string[] = [];
  const len = result.length;

  let i = 1;

  while (i <= len) {
    const ch = string.sub(result, i, i);

    if (ch === "%" && i + 2 <= len) {
      const hex = string.sub(result, i + 1, i + 2);
      const [match] = string.find(hex, "^%x%x$");

      if (match) {
        parts.push(string.char(tonumber(hex, 16)!));
        i += 3;
      } else {
        parts.push(ch);
        i++;
      }
    } else {
      parts.push(ch);
      i++;
    }
  }

  return parts.join("");
}

/** Extracts the first value for a given key from a URL-encoded form body. */
export function parseFormValue(body: string, key: string) {
  for (const pair of body.split("&")) {
    const eqIdx = pair.indexOf("=");

    if (eqIdx >= 0 && pair.substring(0, eqIdx) === key) {
      return urlDecode(pair.substring(eqIdx + 1));
    }
  }

  return undefined;
}

/**
 * Parses URL-encoded form body to extract selected item names.
 * Body format: "item=ObjName/script.slua&item=ObjName/other.slua"
 *
 * Returns an ordered queue of unique object names and a filter map of
 * object name -> selected full item names.
 */
export function parseFormItems(body: string) {
  const filter: Record<string, string[]> = {};
  const queue: string[] = [];
  const objects = getObjectNames();

  for (const pair of body.split("&")) {
    const eqIdx = pair.indexOf("=");

    if (eqIdx < 0) {
      // no-continue: TSTL compiles for->while, continue skips increment
    } else {
      const key = pair.substring(0, eqIdx);

      if (key === "item") {
        const fullName = urlDecode(pair.substring(eqIdx + 1));
        const slashIdx = fullName.indexOf("/");

        if (slashIdx >= 0) {
          const prefix = fullName.substring(0, slashIdx);

          // Pattern prefix like {*-object.obj}, expand to all matching real objects
          if (prefix.startsWith("{") && prefix.indexOf("}") === prefix.length - 1) {
            const pattern = prefix.substring(1, prefix.length - 1);

            for (const obj of objects) {
              if (patternMatches(obj, pattern)) {
                if (filter[obj] === undefined) {
                  filter[obj] = [];
                  queue.push(obj);
                }

                filter[obj].push(fullName);
              }
            }
          } else {
            if (filter[prefix] === undefined) {
              filter[prefix] = [];
              queue.push(prefix);
            }

            filter[prefix].push(fullName);
          }
        }
      }
    }
  }

  return { queue, filter };
}

/**
 * Builds the autoupdate controls reflecting current server state.
 * Returned for GET /autoupdate and POST /autoupdate.
 */
export function buildAutoUpdateControls(enabled: boolean, debounce: number) {
  if (enabled) {
    return (
      <article class="panel">
        <div class="panel-header">Settings</div>
        <div class="panel-body">
          <label>
            <input type="checkbox" name="enabled" checked hx-post="autoupdate" hx-target="#autoupdate" />
            {" Auto-update"}
          </label>
          <label class="debounce-label">
            {"Delay "}
            <input
              type="number"
              name="debounce"
              value={debounce}
              min="1"
              max="60"
              hx-post="autoupdate-debounce"
              hx-target="#autoupdate"
              hx-trigger="change delay:500ms"
            />
            {" s"}
          </label>
        </div>
        {POLL_TRIGGER}
      </article>
    );
  }

  return (
    <article class="panel">
      <div class="panel-header">Settings</div>
      <div class="panel-body">
        <label>
          <input type="checkbox" name="enabled" hx-post="autoupdate" hx-target="#autoupdate" />
          {" Auto-update"}
        </label>
        <label class="debounce-label">
          {"Delay "}
          <input
            type="number"
            name="debounce"
            value={debounce}
            min="1"
            max="60"
            hx-post="autoupdate-debounce"
            hx-target="#autoupdate"
            hx-trigger="change delay:500ms"
          />
          {" s"}
        </label>
      </div>
    </article>
  );
}
