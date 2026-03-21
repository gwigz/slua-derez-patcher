import { getObjectNames, matchesObject } from "./inventory";

// --- State ---

let enabled = false;
let debounceSeconds = 5;
let snapshot: Record<string, string> = {};
let debounceTimer: LLTimerCallback | null = null;
let pendingQueue: string[] = [];

/** Callback set by index.ts to trigger a patch run. */
let triggerPatch: ((queue: string[]) => void) | null = null;

/** Callback set by index.ts to check if a patch is in progress. */
let checkBusy: (() => boolean) | null = null;

/** Callback set by index.ts to push status messages. */
let pushMsg: ((message: string) => void) | null = null;

/** The patcher script's own inventory name, set by setup(). */
let selfName = "";

// --- Internal helpers ---

/** Cancels any running debounce timer. */
function cancelDebounce() {
  if (debounceTimer) {
    LLTimers.off(debounceTimer);
    debounceTimer = null;
  }
}

// --- Public API ---

/**
 * Wires the autoupdate module to the patcher's state. Must be called once
 * during initialization, before any other function.
 */
export function setup(
  self: string,
  trigger: (queue: string[]) => void,
  busy: () => boolean,
  status: (message: string) => void,
) {
  selfName = self;
  triggerPatch = trigger;
  checkBusy = busy;
  pushMsg = status;
}

/** Enables autoupdate and takes an initial inventory snapshot. */
export function enable() {
  cancelDebounce();

  enabled = true;
  snapshot = takeSnapshot();
  pendingQueue = [];
}

/** Disables autoupdate and cancels any pending debounce. */
export function disable() {
  enabled = false;
  cancelDebounce();
  pendingQueue = [];
}

export function isEnabled() {
  return enabled;
}

export function getDebounceSeconds() {
  return debounceSeconds;
}

export function setDebounceSeconds(n: number) {
  debounceSeconds = n;
}

/**
 * Called from the `changed` event handler when `CHANGED_INVENTORY` fires.
 * Resets the debounce timer. When it fires, diffs the snapshot, matches
 * changed items to target objects, and either triggers a patch run or
 * merges into the pending queue if busy.
 */
export function onInventoryChanged() {
  if (!enabled || (checkBusy && checkBusy())) return;

  cancelDebounce();

  debounceTimer = LLTimers.once(debounceSeconds, () => {
    debounceTimer = null;

    const changed = diffSnapshot();

    if (changed.length === 0) return;

    const affected = getAffectedObjects(changed);

    if (affected.length === 0) return;

    if (triggerPatch && pushMsg) {
      pushMsg(`Auto-update: ${changed.length} item(s) changed, patching ${affected.length} object(s)...`);

      triggerPatch(affected);
    }
  });
}

/**
 * Returns and clears any pending autoupdate queue. Called by index.ts
 * when a patch run completes to check for follow-up work.
 */
export function flushPending() {
  const queue = pendingQueue;
  pendingQueue = [];

  return queue;
}

/** Scans all patchable inventory items (those with a `/` separator), returns name -> UUID map. */
function takeSnapshot() {
  const snap: Record<string, string> = {};
  const count = ll.GetInventoryNumber(INVENTORY_ALL);

  for (let i = 0; i < count; i++) {
    const name = ll.GetInventoryName(INVENTORY_ALL, i);

    if (name !== selfName && name.indexOf("/") >= 0) {
      snap[name] = ll.GetInventoryKey(name) as unknown as string;
    }
  }

  return snap;
}

/** Compares current inventory against stored snapshot. Returns changed item names and updates snapshot. */
function diffSnapshot() {
  const changed: string[] = [];
  const newSnap = takeSnapshot();

  // Changed or added items
  for (const name in newSnap) {
    if (snapshot[name] !== newSnap[name]) {
      changed.push(name);
    }
  }

  // Removed items
  for (const name in snapshot) {
    if (newSnap[name] === undefined) {
      changed.push(name);
    }
  }

  snapshot = newSnap;

  return changed;
}

/** Finds which objects are targeted by the changed items using inventory.ts matching. */
function getAffectedObjects(changedItems: string[]) {
  const objects = getObjectNames();
  const affected: string[] = [];

  for (const obj of objects) {
    for (const item of changedItems) {
      if (matchesObject(item, obj)) {
        affected.push(obj);
        break;
      }
    }
  }

  return affected;
}
