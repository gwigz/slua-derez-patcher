import { getObjectNames, getItemsForObject, targetItemName } from "./inventory";

/** Escapes HTML special characters to prevent XSS. Uses split/join (no replaceAll in Luau). */
function escapeHtml(s: string): string {
  let r = s.split("&").join("&amp;");
  r = r.split("<").join("&lt;");
  r = r.split(">").join("&gt;");
  r = r.split('"').join("&quot;");
  return r;
}

/** Builds a single item row with checkbox, name, and type badge. */
function buildItemRow(fullItemName: string, typeClass: string, typeLabel: string) {
  const itemName = escapeHtml(targetItemName(fullItemName));
  const fullName = escapeHtml(fullItemName);

  return (
    '<div class="item-row">' +
    '<input type="checkbox" name="item" value="' +
    fullName +
    '" x-on:change="sync()" />' +
    '<span class="item-name truncate">' +
    itemName +
    "</span>" +
    '<span class="item-type ' +
    typeClass +
    '">' +
    typeLabel +
    "</span>" +
    "</div>"
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

      const badge = parts.join(" ");

      // Object group with expandable details
      html += '<details class="obj-group">';

      // Summary = object header with checkbox
      html +=
        "<summary>" +
        '<div class="obj-header">' +
        '<span class="obj-toggle">&#9654;</span>' +
        '<input type="checkbox"' +
        " x-on:click.stop" +
        " x-on:change=\"toggleObject('" +
        escaped +
        "')\"" +
        " />" +
        '<span class="obj-name truncate">' +
        escaped +
        "</span>" +
        '<span class="obj-badge">' +
        badge +
        "</span>" +
        "</div>" +
        "</summary>";

      // Item rows
      html += '<div class="obj-items">';

      for (const script of scripts) {
        html += buildItemRow(script, "item-type-script", "script");
      }

      for (const item of items) {
        html += buildItemRow(item, "item-type-item", "item");
      }

      html += "</div>"; // obj-items
      html += "</details>"; // obj-group
    }
  }

  if (html === "") {
    return '<div class="empty-state">No patchable objects found in inventory.</div>';
  }

  return '<div class="obj-list">' + html + "</div>";
}

/**
 * Builds a status fragment showing current patch progress.
 * Includes an hx-get="poll" trigger to continue long polling while busy.
 */
export function buildStatusFragment(busy: boolean, index: number, total: number, log: string[]) {
  let html = "";

  if (busy) {
    const pct = total > 0 ? math.floor((index / total) * 100) : 0;

    html +=
      '<div class="status-header">' +
      '<span class="status-dot status-dot-busy"></span>' +
      "<span>Patching</span>" +
      '<span class="status-pct">' +
      index +
      "/" +
      total +
      " (" +
      pct +
      "%)</span>" +
      "</div>";

    html += '<progress value="' + index + '" max="' + total + '"></progress>';
  } else {
    html +=
      '<div class="status-header">' +
      '<span class="status-dot status-dot-ready"></span>' +
      "<span>Done</span>" +
      "</div>";
  }

  if (log.length > 0) {
    html += '<div class="status-log">';

    for (const entry of log) {
      html += "<p>" + escapeHtml(entry) + "</p>";
    }

    html += "</div>";
  }

  if (busy) {
    html += '<div hx-get="poll" hx-trigger="load" hx-target="#status" hx-swap="innerHTML"></div>';
  }

  return html;
}

/**
 * Decodes a single URL-encoded value (+ → space, %XX → char).
 *
 * Uses manual hex-to-number conversion because TSTL inserts a spurious `nil`
 * self argument into `tonumber()` calls (slua-types missing @noSelf), so
 * `tonumber(hex, 16)` compiles to `tonumber(nil, hex, 16)` which is wrong.
 *
 * Collects parts into an array and joins once to avoid O(N²) string concat.
 */
function urlDecode(encoded: string) {
  let result = string.gsub(encoded, "+", " ")[0];

  // Iterate byte-by-byte (1-indexed for Luau) replacing %XX sequences
  const parts: string[] = [];
  let i = 1;
  const len = result.length;

  while (i <= len) {
    const ch = string.sub(result, i, i);

    if (ch === "%" && i + 2 <= len) {
      const hex = string.sub(result, i + 1, i + 2);
      const [match] = string.find(hex, "^%x%x$");

      if (match) {
        // Manual hex→number: 0-9 = 48-57, A-F = 65-70, a-f = 97-102
        let n = 0;

        for (let j = 1; j <= 2; j++) {
          // string.byte returns number[] in types but number in Luau
          const byte = string.byte(hex, j) as unknown as number;
          let digit: number;

          if (byte >= 48 && byte <= 57) {
            digit = byte - 48;
          } else if (byte >= 65 && byte <= 70) {
            digit = byte - 55;
          } else {
            digit = byte - 87;
          }

          n = n * 16 + digit;
        }

        parts.push(string.char(n));
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

/**
 * Parses URL-encoded form body to extract selected item names.
 * Body format: "item=ObjName/script.slua&item=ObjName/other.slua"
 *
 * Returns an ordered queue of unique object names and a filter map of
 * object name → selected full item names.
 */
export function parseFormItems(body: string) {
  const filter: Record<string, string[]> = {};
  const queue: string[] = [];

  for (const pair of body.split("&")) {
    const eqIdx = pair.indexOf("=");

    if (eqIdx < 0) {
      // no-continue: TSTL compiles for→while, continue skips increment
    } else {
      const key = pair.substring(0, eqIdx);

      if (key === "item") {
        const fullName = urlDecode(pair.substring(eqIdx + 1));
        const slashIdx = fullName.indexOf("/");

        if (slashIdx >= 0) {
          const objName = fullName.substring(0, slashIdx);

          if (filter[objName] === undefined) {
            filter[objName] = [];
            queue.push(objName);
          }

          filter[objName].push(fullName);
        }
      }
    }
  }

  return { queue, filter };
}
