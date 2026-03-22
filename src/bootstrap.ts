/**
 * SLua Derez Patcher — bootstrap receiver for target objects
 *
 * Drop this script into every object that the patcher should be able to
 * update. When the object is rezzed with a signed start string ("pin|hash"),
 * this script verifies the hash against a shared secret, sets the pin, and
 * signals "pinned" to the patcher. After all items and scripts have been
 * transferred, it clears the pin and replies "ready" so the patcher can
 * derez the object back to inventory.
 *
 * @version 0.1.0
 * @link https://github.com/gwigz/slua-derez-patcher
 */

/** Active listen handle, or 0 when not listening. */
let listenHandle = 0;

/** Authenticated patcher UUID for the current session. */
let patcherId: uuid;

LLEvents.on("on_rez", () => {
  ll.SetRemoteScriptAccessPin(0);

  const startString = ll.GetStartString();
  if (startString === "") return;

  const parts = startString.split("|");
  if (parts.length !== 2) return;

  const [pinStr, signature] = parts;
  if (ll.ComputeHash(SECRET + "|" + pinStr, "sha256") !== signature) return;

  const pin = tonumber(pinStr);
  if (pin === undefined || pin === 0) return;

  ll.SetRemoteScriptAccessPin(pin);
  patcherId = NULL_KEY as unknown as uuid;

  if (listenHandle !== 0) {
    ll.ListenRemove(listenHandle);
  }

  listenHandle = ll.Listen(COMM_CHANNEL, "", NULL_KEY as unknown as uuid, "");

  ll.RegionSay(COMM_CHANNEL, "pinned|" + VERSION);
});

LLEvents.on("listen", (channel, name, id, message) => {
  if (channel !== COMM_CHANNEL) return;

  if (!patcherId.istruthy) {
    if (ll.GetOwnerKey(id) !== ll.GetOwner()) return;
    patcherId = id;
  } else if (id !== patcherId) {
    return;
  }

  if (message === "done") {
    ll.SetRemoteScriptAccessPin(0);
    ll.RegionSayTo(id, COMM_CHANNEL, "ready");

    if (listenHandle !== 0) {
      ll.ListenRemove(listenHandle);

      listenHandle = 0;
    }

    patcherId = NULL_KEY as unknown as uuid;
  } else if (message.startsWith("remove|")) {
    const itemName = message.substring(7);
    if (ll.GetInventoryType(itemName) !== INVENTORY_NONE) {
      ll.RemoveInventory(itemName);
    }
    ll.RegionSayTo(id, COMM_CHANNEL, "removed");
  } else if (message === "cleanup") {
    ll.SetRemoteScriptAccessPin(0);

    if (listenHandle !== 0) {
      ll.ListenRemove(listenHandle);
      listenHandle = 0;
    }

    patcherId = NULL_KEY as unknown as uuid;

    ll.RegionSayTo(id, COMM_CHANNEL, "cleaned");

    LLTimers.once(1.0, () => {
      ll.RemoveInventory(ll.GetScriptName());
    });
  }
});
