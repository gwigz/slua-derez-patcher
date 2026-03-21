import { getObjectNames, getItemsForObject, patternMatches, targetItemName } from "./inventory";

function itemRow(fullName: string, itemName: string, typeClass: string, typeLabel: string) {
  return (
    <div class="item-row">
      <input type="checkbox" name="item" value={fullName} {...{ "x-on:change": "sync()" }} />
      <b class="item-name truncate">{itemName}</b>
      <b class={"item-type " + typeClass}>{typeLabel}</b>
    </div>
  );
}

function objHeader(escapedName: string, badge: string) {
  return (
    <summary>
      <div class="obj-header">
        <b class="obj-toggle">{"&#9654;"}</b>
        <input
          type="checkbox"
          {...{
            "x-on:click.stop": true,
            "x-on:change": `toggleObject('${escapedName}')`,
          }}
        />
        <b class="obj-name truncate">{escapedName}</b>
        <b class="obj-badge">{badge}</b>
      </div>
    </summary>
  );
}

function objGroup(content: string) {
  return <details class="obj-group">{content}</details>;
}

function objItems(content: string) {
  return <div class="obj-items">{content}</div>;
}

function objList(content: string) {
  return <div class="obj-list">{content}</div>;
}

function statusBusy(index: string | number, total: string | number, pct: string | number) {
  return (
    <div class="status-header">
      <b class="status-dot status-dot-busy"></b>
      <b>Patching</b>
      <b class="status-pct">
        {index}/{total} ({pct}%)
      </b>
    </div>
  );
}

function progressBar(index: string | number, total: string | number) {
  return <progress value={index} max={total}></progress>;
}

function logEntry(entry: string) {
  return <p>{entry}</p>;
}

function statusLog(content: string) {
  return <div class="status-log">{content}</div>;
}

function autoUpdateOn(debounce: string | number) {
  return (
    <div class="autoupdate-panel">
      <div class="autoupdate-header">Settings</div>
      <div class="autoupdate-bar">
        <label>
          <input
            type="checkbox"
            name="enabled"
            checked
            hx-post="autoupdate"
            hx-target="#autoupdate"
          />
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
            hx-trigger="change"
          />
          {" s"}
        </label>
      </div>
    </div>
  );
}

const EMPTY_STATE = <div class="empty-state">No patchable objects found in inventory.</div>;

const STATUS_DONE = (
  <div class="status-header">
    <b class="status-dot status-dot-ready"></b>
    <b>Done</b>
  </div>
);

const POLL_TRIGGER = <div hx-get="poll" hx-trigger="load" hx-target="#status"></div>;

const AUTO_UPDATE_OFF = (
  <div class="autoupdate-panel">
    <div class="autoupdate-header">Settings</div>
    <div class="autoupdate-bar">
      <label>
        <input type="checkbox" name="enabled" hx-post="autoupdate" hx-target="#autoupdate" />
        {" Auto-update"}
      </label>
    </div>
  </div>
);

export const NO_ITEMS_SELECTED = (
  <div class="status-header">
    <b class="status-dot status-dot-ready"></b>
    <b>No items selected</b>
  </div>
);

// Runtime code (passes through unchanged)

/** Escapes HTML special characters to prevent XSS. */
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Builds a single item row with checkbox, name, and type badge. */
function buildItemRow(fullItemName: string, typeClass: string, typeLabel: string) {
  return itemRow(
    escapeHtml(fullItemName),
    escapeHtml(targetItemName(fullItemName)),
    typeClass,
    typeLabel,
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

      // Count badge
      const parts: string[] = [];

      if (scripts.length > 0) {
        parts.push(scripts.length + "s");
      }

      if (items.length > 0) {
        parts.push(items.length + "i");
      }

      // Item rows
      let itemsHtml = "";

      for (const script of scripts) {
        itemsHtml += buildItemRow(script, "item-type-script", "script");
      }

      for (const item of items) {
        itemsHtml += buildItemRow(item, "item-type-item", "item");
      }

      html += objGroup(objHeader(escaped, parts.join(" ")) + objItems(itemsHtml));
    }
  }

  if (html === "") {
    return EMPTY_STATE;
  }

  return objList(html);
}

/**
 * Builds a status fragment showing current patch progress.
 * Includes an hx-get="poll" trigger to continue long polling while busy.
 */
export function buildStatusFragment(busy: boolean, index: number, total: number, log: string[]) {
  let html = "";

  if (busy) {
    const pct = total > 0 ? math.floor((index / total) * 100) : 0;

    html += statusBusy(index, total, pct);
    html += progressBar(index, total);
  } else {
    html += STATUS_DONE;
  }

  if (log.length > 0) {
    let logHtml = "";

    for (const entry of log) {
      logHtml += logEntry(escapeHtml(entry));
    }

    html += statusLog(logHtml);
  }

  if (busy) {
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
    return autoUpdateOn(debounce);
  }

  return AUTO_UPDATE_OFF;
}
