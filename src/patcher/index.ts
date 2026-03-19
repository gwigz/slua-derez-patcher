/**
 * Patcher script. Rezzes objects from inventory, transfers scripts and items
 * into them via `ll.RemoteLoadScriptPin`, then derezzes them back.
 *
 * Commands (CMD_CHANNEL):
 *   patch <name>   Patch a single object
 *   patch all      Patch all objects with matching items
 *   list           Show all patchable objects and their items
 *
 * Protocol (COMM_CHANNEL):
 *   1. Patcher rezzes object with PIN as start param
 *   2. Bootstrap sets pin, sends "pinned"
 *   3. Patcher transfers items and scripts, sends "done"
 *   4. Bootstrap confirms with "ready"
 *   5. Patcher derezzes object back to inventory
 */
import { getItemsForObject, targetItemName } from "./inventory";
import { handleList, handlePatch } from "./commands";
import { setStatus, clearStatus, startParticles, stopParticles } from "./effects";

/** Shared secret between patcher and bootstrap for `ll.RemoteLoadScriptPin`. */
const PIN = 87654321;

/** Owner chat channel for commands. */
const CMD_CHANNEL = 7;

/** Internal channel for patcher/bootstrap protocol messages. */
const COMM_CHANNEL = -47123;

/** This script's inventory name, used to avoid patching ourselves. */
const SELF_NAME = ll.GetScriptName();

/** UUID of the object currently being patched. */
let currentObjectId: uuid;

/** Inventory name of the object currently being patched. */
let currentObjectName = "";

/** Ordered list of object names waiting to be patched. */
let patchQueue: string[] = [];

/** Current position in the patch queue (0-indexed). */
let queueIndex = 0;

/** Whether a patch operation is in progress. Prevents concurrent patching. */
let busy = false;

/** Handle for the per-object timeout timer, cleared on successful response. */
let timeoutTimer: LLTimerCallback | null = null;

/**
 * Advances to the next object in the queue. Rezzes it with PIN, sets up a
 * timeout, and waits for the bootstrap handshake. Clears state when the
 * queue is exhausted.
 */
function patchNext() {
  if (queueIndex >= patchQueue.length) {
    busy = false;
    patchQueue = [];
    queueIndex = 0;

    clearStatus();

    return;
  }

  currentObjectName = patchQueue[queueIndex];
  queueIndex++;

  const { scripts, items } = getItemsForObject(SELF_NAME, currentObjectName);

  if (scripts.length === 0 && items.length === 0) {
    ll.OwnerSay("No items found for " + currentObjectName + ", skipping.");

    patchNext();

    return;
  }

  setStatus(
    currentObjectName +
      "\n" +
      scripts.length +
      " script(s), " +
      items.length +
      " item(s)" +
      "\n[" +
      queueIndex +
      "/" +
      patchQueue.length +
      "]",
  );

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
  const timeoutSeconds = scripts.length * 3.5 + 10;

  timeoutTimer = LLTimers.once(timeoutSeconds, () => {
    stopParticles();

    ll.OwnerSay("Timeout waiting for " + currentObjectName + ", derezing.");
    ll.DerezObject(currentObjectId, DEREZ_DIE);

    timeoutTimer = null;

    patchNext();
  });
}

/** Initializes the queue and kicks off the first patch. */
function startPatching(queue: string[]) {
  patchQueue = queue;
  queueIndex = 0;
  busy = true;

  patchNext();
}

LLEvents.on("listen", (channel, _name, id, message) => {
  // Owner commands
  if (channel === CMD_CHANNEL) {
    if (id !== ll.GetOwner()) return;

    const parts = message.split(" ");
    const cmd = parts[0];

    if (cmd === "patch") {
      if (busy) {
        ll.OwnerSay("Already patching, please wait.");
        return;
      }

      const target = parts[1];

      if (!target || target === "") {
        ll.OwnerSay("Usage: patch <ObjectName> | patch all");
        return;
      }

      handlePatch(SELF_NAME, target, startPatching);
    } else if (cmd === "list") {
      handleList(SELF_NAME);
    }
    // Bootstrap protocol
  } else if (channel === COMM_CHANNEL && busy) {
    // Object is rezzed and pinned, transfer inventory
    if (message === "pinned" && id === currentObjectId) {
      const { scripts, items } = getItemsForObject(SELF_NAME, currentObjectName);

      for (const item of items) {
        ll.GiveInventory(currentObjectId, item);
      }

      startParticles(currentObjectId);

      for (const script of scripts) {
        setStatus(
          currentObjectName +
            "\nLoading " +
            targetItemName(script) +
            "\n[" +
            queueIndex +
            "/" +
            patchQueue.length +
            "]",
        );

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

      ll.OwnerSay(currentObjectName + " patched successfully, derezing to inventory.");
      ll.DerezObject(currentObjectId, DEREZ_TO_INVENTORY);

      patchNext();
    }
  }
});

// TODO: look into this NULL_KEY typing issue
ll.Listen(CMD_CHANNEL, "", NULL_KEY as unknown as uuid, "");
ll.Listen(COMM_CHANNEL, "", NULL_KEY as unknown as uuid, "");
