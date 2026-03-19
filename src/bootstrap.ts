/**
 * Bootstrap script, loaded into target objects via `ll.RemoteLoadScriptPin`.
 *
 * On rez with the correct PIN, opens a listener on the comm channel and
 * signals "pinned" to the patcher. Once the patcher finishes transferring
 * scripts and items and sends "done", responds with "ready" and cleans up
 * the listener.
 */

/** Must match the PIN used by the patcher script. */
const PIN = 87654321;

/** Shared comm channel for the patcher/bootstrap protocol. */
const COMM_CHANNEL = -47123;

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
