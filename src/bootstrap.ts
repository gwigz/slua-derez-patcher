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
 * @link https://github.com/gwigz/slua-derez-patcher
 */

/** Active listen handle, or 0 when not listening. */
let listenHandle = 0;

LLEvents.on("on_rez", () => {
  const startString = ll.GetStartString();
  if (startString === "") return;

  const parts = startString.split("|");
  if (parts.length !== 2) return;

  const [pinStr, signature] = parts;
  if (ll.ComputeHash(SECRET + "|" + pinStr, "sha256") !== signature) return;

  const pin = tonumber(pinStr);
  if (pin === undefined || pin === 0) return;

  ll.SetRemoteScriptAccessPin(pin);

  if (listenHandle !== 0) {
    ll.ListenRemove(listenHandle);
  }

  listenHandle = ll.Listen(COMM_CHANNEL, "", NULL_KEY as unknown as uuid, "");

  ll.RegionSay(COMM_CHANNEL, "pinned");
});

LLEvents.on("listen", (channel, name, id, message) => {
  if (channel !== COMM_CHANNEL) return;

  if (message === "done") {
    ll.SetRemoteScriptAccessPin(0);
    ll.RegionSayTo(id, COMM_CHANNEL, "ready");

    if (listenHandle !== 0) {
      ll.ListenRemove(listenHandle);

      listenHandle = 0;
    }
  } else if (message === "cleanup") {
    if (listenHandle !== 0) {
      ll.ListenRemove(listenHandle);
      listenHandle = 0;
    }

    ll.RegionSayTo(id, COMM_CHANNEL, "cleaned");

    LLTimers.once(1.0, () => {
      ll.RemoveInventory(ll.GetScriptName());
    });
  }
});
