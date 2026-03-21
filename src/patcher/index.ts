/**
 * Patcher script. Rezzes objects from inventory, transfers scripts and items
 * into them via `ll.RemoteLoadScriptPin`, then derezzes them back.
 *
 * Provides a web UI via HTTP-in for controlling patch operations.
 * Chat command `/7 url` prints the HTTP-in URL.
 *
 * Protocol (COMM_CHANNEL):
 *   1. Patcher rezzes object with PIN as start param
 *   2. Bootstrap sets pin, sends "pinned"
 *   3. Patcher transfers items and scripts, sends "done"
 *   4. Bootstrap confirms with "ready"
 *   5. Patcher derezzes object back to inventory
 */
import { getItemsForObject, getObjectNames, targetItemName } from "./inventory";
import { setStatus, clearStatus, startParticles, stopParticles } from "./effects";
import { pageShell, APP_FRAGMENT } from "./template";
import {
  buildObjectList,
  buildStatusFragment,
  parseFormItems,
  parseFormValue,
  buildAutoUpdateControls,
  NO_ITEMS_SELECTED,
} from "./ui";
import {
  setup as setupAutoUpdate,
  onInventoryChanged,
  flushPending,
  isEnabled as isAutoUpdateEnabled,
  enable as enableAutoUpdate,
  disable as disableAutoUpdate,
  getDebounceSeconds,
  setDebounceSeconds,
} from "./autopatch";

/** This script's inventory name, used to avoid patching ourselves. */
const SELF_NAME = ll.GetScriptName();

// --- Patch state ---

/** UUID of the object currently being patched. */
let currentObjectId: uuid;

/** Inventory name of the object currently being patched. */
let currentObjectName = "";

/** Ordered list of object names waiting to be patched. */
let patchQueue: string[] = [];

/** Map of object name -> selected full item names. Empty array = all items. */
let patchItemFilter: Record<string, string[]> = {};

/** Current position in the patch queue (0-indexed). */
let queueIndex = 0;

/** Whether a patch operation is in progress. Prevents concurrent patching. */
let busy = false;

/** Handle for the per-object timeout timer, cleared on successful response. */
let timeoutTimer: LLTimerCallback | null = null;

/** Cached inventory scan for the current object, set by patchNext(), used by "pinned" handler. */
let pendingScripts: string[] = [];
let pendingItems: string[] = [];

// --- HTTP state ---

/** The HTTP-in URL assigned by the simulator. */
let httpUrl = "";

/**
 * Held long-poll request ID, or empty string when no poll is pending.
 *
 * Long-poll flow:
 *   1. Browser GET /poll -> SLua stores requestId here, starts 20s timer
 *   2. On patch state change -> pushStatus() calls respondPoll() immediately
 *   3. Response includes hx-get="poll" hx-trigger="load" -> browser loops
 *   4. If no update in 20s -> timer fires respondPoll() with unchanged status
 *   5. When patching completes -> response omits hx-trigger, loop stops
 */
let pollRequestId = "";

/** Timer for the 20s long-poll timeout. */
let pollTimer: LLTimerCallback | null = null;

/** Recent status messages for the web UI. */
let statusLog: string[] = [];

/** Appends a status message to the log and owner chat, without triggering a poll response. */
function logStatus(message: string) {
  ll.OwnerSay(message);

  statusLog.push(message);

  if (statusLog.length > 20) {
    statusLog.shift();
  }
}

/**
 * Pushes a status message to the log and responds to any held poll request.
 * Also sends the message to owner chat.
 */
function pushStatus(message: string) {
  logStatus(message);

  if (pollRequestId !== "") {
    respondPoll();
  }
}

/** Builds a status fragment from current patch state. */
function statusFragment() {
  // queueIndex is incremented when an object starts, not when it finishes.
  // Show completed count (one less than current index) while busy.
  const completed = busy ? math.max(0, queueIndex - 1) : 0;

  return buildStatusFragment(busy, completed, patchQueue.length, statusLog);
}

/** Responds to the held long-poll request with current status. */
function respondPoll() {
  if (pollRequestId === "") return;

  respondHtml(pollRequestId as unknown as uuid, statusFragment());

  pollRequestId = "";

  if (pollTimer) {
    LLTimers.off(pollTimer);

    pollTimer = null;
  }
}

/**
 * Advances to the next object in the queue. Rezzes it with PIN, sets up a
 * timeout, and waits for the bootstrap handshake. Clears state when the
 * queue is exhausted.
 */
function patchNext() {
  if (queueIndex >= patchQueue.length) {
    busy = false;
    patchQueue = [];
    patchItemFilter = {};
    queueIndex = 0;

    // Check for pending autoupdate changes before declaring done
    const pending = flushPending();

    if (pending.length > 0) {
      pushStatus(`Auto-update: patching ${pending.length} queued object(s)...`);
      startPatching(pending, undefined, false);
      return;
    }

    clearStatus();
    pushStatus("All objects patched.");

    return;
  }

  currentObjectName = patchQueue[queueIndex];
  queueIndex++;

  // Cache inventory scan -reused by the "pinned" handler to avoid a second scan
  const { scripts, items } = getItemsForObject(SELF_NAME, currentObjectName);

  // Apply per-item filter if this object has a specific selection
  const filter = patchItemFilter[currentObjectName];

  if (filter && filter.length > 0) {
    pendingScripts = scripts.filter((s) => filter.includes(s));
    pendingItems = items.filter((it) => filter.includes(it));
  } else {
    pendingScripts = scripts;
    pendingItems = items;
  }

  if (pendingScripts.length === 0 && pendingItems.length === 0) {
    pushStatus(`No items found for ${currentObjectName}, skipping.`);

    patchNext();

    return;
  }

  setStatus(
    currentObjectName +
      "\n" +
      pendingScripts.length +
      " script(s), " +
      pendingItems.length +
      " item(s)" +
      "\n[" +
      queueIndex +
      "/" +
      patchQueue.length +
      "]",
  );

  pushStatus(`Rezzing ${currentObjectName}... [${queueIndex}/${patchQueue.length}]`);

  // Rez 1m above prim center with PIN as start param
  currentObjectId = ll.RezObjectWithParams(currentObjectName, [
    REZ_POS,
    new Vector(0, 0, 1),
    1,
    0,
    REZ_PARAM,
    PIN,
  ]);

  // 3.5s per script (RemoteLoadScriptPin delay) plus 10s buffer
  const timeoutSeconds = pendingScripts.length * 3.5 + 10;

  timeoutTimer = LLTimers.once(timeoutSeconds, () => {
    stopParticles();

    pushStatus(`Timeout waiting for ${currentObjectName}, derezing.`);
    ll.DerezObject(currentObjectId, DEREZ_DIE);

    timeoutTimer = null;

    patchNext();
  });
}

/** Initializes the queue and kicks off the first patch. */
function startPatching(queue: string[], itemFilter?: Record<string, string[]>, resetLog = true) {
  patchQueue = queue;
  patchItemFilter = itemFilter || {};
  queueIndex = 0;
  busy = true;

  if (resetLog) {
    statusLog = [];
  }

  pushStatus(`Patching ${queue.length} object(s)...`);

  patchNext();
}

/** Releases the current HTTP-in URL and requests a new one. */
function refreshUrl() {
  // Cancel any held long-poll request (now invalid)
  pollRequestId = "";

  if (pollTimer) {
    LLTimers.off(pollTimer);
    pollTimer = null;
  }

  if (httpUrl !== "") {
    ll.ReleaseURL(httpUrl);
    httpUrl = "";
  }

  ll.RequestURL();
}

/** Sends an XHTML response so browsers render HTTP-in content correctly. */
function respondHtml(requestId: uuid, body: string) {
  ll.SetContentType(requestId, CONTENT_TYPE_XHTML);
  ll.HTTPResponse(requestId, 200, body);
}

// --- HTTP request handler ---

LLEvents.on("http_request", (requestId, method, body) => {
  // URL grant/denial from ll.RequestURL()
  if (method === URL_REQUEST_GRANTED) {
    httpUrl = body;
    ll.OwnerSay(`Web UI: ${httpUrl}`);
    return;
  }

  if (method === URL_REQUEST_DENIED) {
    ll.OwnerSay(`Failed to get HTTP URL: ${body}`);
    return;
  }

  const url = ll.GetHTTPHeader(requestId, "x-path-info");

  if (method === "GET") {
    if (url === "" || url === "/") {
      // Inject runtime base URL so relative hx-get/hx-post paths resolve correctly
      respondHtml(requestId, pageShell(httpUrl));
    } else if (url === "/app") {
      respondHtml(requestId, APP_FRAGMENT);
    } else if (url === "/objects") {
      respondHtml(requestId, buildObjectList(SELF_NAME));
    } else if (url === "/poll") {
      // Hold the request for long polling
      if (pollRequestId !== "") {
        // Cancel previous poll -respond to stale request
        respondHtml(pollRequestId as unknown as uuid, statusFragment());
      }

      pollRequestId = requestId as unknown as string;

      if (pollTimer) {
        LLTimers.off(pollTimer);
      }

      // 20s timeout -stay under SL's 30s HTTP-in limit
      pollTimer = LLTimers.once(20, () => {
        pollTimer = null;

        respondPoll();
      });
    } else if (url === "/autoupdate") {
      respondHtml(requestId, buildAutoUpdateControls(isAutoUpdateEnabled(), getDebounceSeconds()));
    } else {
      ll.HTTPResponse(requestId, 404, "Not found");
    }
  } else if (method === "POST") {
    if (url === "/patch") {
      if (busy) {
        respondHtml(requestId, statusFragment());
        return;
      }

      const { queue, filter } = parseFormItems(body);

      if (queue.length === 0) {
        respondHtml(requestId, NO_ITEMS_SELECTED);
        return;
      }

      startPatching(queue, filter);

      respondHtml(requestId, statusFragment());
    } else if (url === "/patch-all") {
      if (busy) {
        respondHtml(requestId, statusFragment());
        return;
      }

      const queue: string[] = [];

      for (const obj of getObjectNames()) {
        const { scripts, items } = getItemsForObject(SELF_NAME, obj);

        if (scripts.length > 0 || items.length > 0) {
          queue.push(obj);
        }
      }

      if (queue.length > 0) {
        startPatching(queue);
      }

      respondHtml(requestId, statusFragment());
    } else if (url === "/autoupdate") {
      if (parseFormValue(body, "enabled") === "on") {
        enableAutoUpdate();
      } else {
        disableAutoUpdate();
      }

      respondHtml(requestId, buildAutoUpdateControls(isAutoUpdateEnabled(), getDebounceSeconds()));
    } else if (url === "/autoupdate-debounce") {
      const seconds = tonumber(parseFormValue(body, "debounce") || "");

      if (seconds !== undefined && seconds >= 1 && seconds <= 60) {
        setDebounceSeconds(seconds);
      }

      respondHtml(requestId, buildAutoUpdateControls(isAutoUpdateEnabled(), getDebounceSeconds()));
    } else {
      ll.HTTPResponse(requestId, 404, "Not found");
    }
  } else {
    ll.HTTPResponse(requestId, 405, "Method not allowed");
  }
});

// --- Bootstrap protocol listener ---

LLEvents.on("listen", (channel, _name, id, message) => {
  // Owner URL command
  if (channel === CMD_CHANNEL) {
    if (id !== ll.GetOwner()) return;

    if (message === "url") {
      if (httpUrl !== "") {
        ll.OwnerSay(httpUrl);
      } else {
        ll.OwnerSay("HTTP URL not yet available.");
      }
    } else if (message === "auto" || message.startsWith("auto ")) {
      const arg = message.substring(5).trim();

      if (arg !== "") {
        const seconds = tonumber(arg);

        if (seconds !== undefined && seconds >= 1) {
          setDebounceSeconds(seconds);
          enableAutoUpdate();
          ll.OwnerSay(`Auto-update enabled (${seconds}s debounce).`);
        } else {
          ll.OwnerSay("Usage: /7 auto [seconds]");
        }
      } else if (isAutoUpdateEnabled()) {
        disableAutoUpdate();
        ll.OwnerSay("Auto-update disabled.");
      } else {
        enableAutoUpdate();
        ll.OwnerSay(`Auto-update enabled (${getDebounceSeconds()}s debounce).`);
      }
    }
    // Bootstrap protocol
  } else if (channel === COMM_CHANNEL && busy) {
    // Object is rezzed and pinned, transfer inventory using cached scan from patchNext()
    if (message === "pinned" && id === currentObjectId) {
      for (const item of pendingItems) {
        ll.GiveInventory(currentObjectId, item);
      }

      startParticles(currentObjectId);

      for (const script of pendingScripts) {
        const name = targetItemName(script);

        setStatus(
          currentObjectName +
            "\nLoading " +
            name +
            "\n[" +
            queueIndex +
            "/" +
            patchQueue.length +
            "]",
        );

        pushStatus(`Loading ${name} into ${currentObjectName}`);

        ll.RemoteLoadScriptPin(currentObjectId, script, PIN, 1, 0);
      }

      stopParticles();

      ll.RegionSayTo(currentObjectId, COMM_CHANNEL, "done");
      // Transfer complete, derez back to inventory
    } else if (message === "ready" && id === currentObjectId) {
      if (timeoutTimer) {
        LLTimers.off(timeoutTimer);

        timeoutTimer = null;
      }

      // Log without consuming the poll, let patchNext() deliver the
      // final state so the UI sees busy=false immediately.
      logStatus(`${currentObjectName} patched successfully.`);

      ll.DerezObject(currentObjectId, DEREZ_TO_INVENTORY);

      patchNext();
    }
  }
});

LLEvents.on("on_rez", () => {
  refreshUrl();
});

LLEvents.on("attach", () => {
  refreshUrl();
});

LLEvents.on("changed", (change) => {
  if ((change & CHANGED_INVENTORY) !== 0) {
    onInventoryChanged();
  }

  if ((change & (CHANGED_REGION | CHANGED_REGION_START)) !== 0) {
    refreshUrl();
  }
});

// TODO: look into this NULL_KEY typing issue
ll.Listen(CMD_CHANNEL, "", NULL_KEY as unknown as uuid, "");
ll.Listen(COMM_CHANNEL, "", NULL_KEY as unknown as uuid, "");

ll.RequestURL();

setupAutoUpdate(SELF_NAME, startPatching, () => busy, pushStatus);

/** Scoped to drop unused variables from the global scope. */
{
  const used = ll.GetUsedMemory();
  const limit = ll.GetMemoryLimit();

  ll.OwnerSay(
    `Memory: ${Math.floor(used / 1024)}KB / ${Math.floor(limit / 1024)}KB (${Math.floor((used / limit) * 100)}%)`,
  );
}
