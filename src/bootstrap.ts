/**
 * SLua Derez Patcher — bootstrap receiver for target objects
 *
 * Drop this script into every object that the patcher should be able to
 * update. It sets a remote script access PIN so the patcher can load
 * scripts into the object via ll.RemoteLoadScriptPin.
 *
 * When the object is rezzed with the correct PIN as its start parameter,
 * this script signals "pinned" to the patcher, waits for a "done" message
 * once all items and scripts have been transferred, then replies "ready"
 * so the patcher can derez the object back to inventory.
 *
 * @link https://github.com/gwigz/slua-derez-patcher
 */

/** Active listen handle, or 0 when not listening. */
let listenHandle = 0;

ll.SetRemoteScriptAccessPin(PIN);

LLEvents.on("on_rez", (startParam) => {
  if (startParam === PIN) {
    if (listenHandle !== 0) {
      ll.ListenRemove(listenHandle);
    }

    listenHandle = ll.Listen(COMM_CHANNEL, "", NULL_KEY as unknown as uuid, "");

    ll.RegionSay(COMM_CHANNEL, "pinned");
  }
});

LLEvents.on("listen", (channel, name, id, message) => {
  if (channel === COMM_CHANNEL && message === "done") {
    ll.RegionSayTo(id, COMM_CHANNEL, "ready");

    if (listenHandle !== 0) {
      ll.ListenRemove(listenHandle);

      listenHandle = 0;
    }
  }
});
