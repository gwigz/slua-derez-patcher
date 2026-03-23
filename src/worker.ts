/**
 * SLua Derez Patcher — worker script for parallel script loading
 *
 * Place copies of this script (named "patcher-worker[1]", "patcher-worker[2]",
 * etc.) in the same prim as the patcher. Each worker listens for load
 * commands via link_message and calls ll.RemoteLoadScriptPin in parallel,
 * reducing total patch time from N*3s to ceil(N/W)*3s.
 *
 * @version 0.1.0
 * @link https://github.com/gwigz/slua-derez-patcher
 */

/** This worker's index, extracted from the script name (e.g. "patcher-worker[1]" -> 1). */
const SCRIPT_NAME = ll.GetScriptName();
const WORKER_INDEX = tonumber(SCRIPT_NAME.substring(15, SCRIPT_NAME.length - 1))!;

/** Cached worker channel, derived from SECRET + linkset root key. Reset on rez. */
let workerChannel = 0;

/** Computes the shared worker channel from SECRET and the linkset root key. */
function computeWorkerChannel(): number {
  const hash = ll.ComputeHash(SECRET + "|worker|" + ll.GetLinkKey(1), "md5");
  return -tonumber(hash.substring(0, 7), 16)!;
}

/** Derives a deterministic pin from a nonce, matching the patcher's derivation. */
function derivePin(nonce: uuid): number {
  const hash = ll.ComputeHash(SECRET + "|" + nonce, "sha256");
  return (tonumber(hash.substring(0, 8), 16)! % 2147483646) + 1;
}

/** Verifies a truncated keyed hash signature on a payload. */
function verifyMessage(payload: string, sig: string): boolean {
  return ll.ComputeHash(SECRET + "|" + payload, "sha256").substring(0, 16) === sig;
}

/** Signs a payload with a truncated keyed hash. */
function signMessage(payload: string): string {
  return ll.ComputeHash(SECRET + "|" + payload, "sha256").substring(0, 16);
}

LLEvents.on("link_message", (_sender, num, str, key) => {
  if (num !== workerChannel) return;

  const parts = (str as string).split("|");
  if (parts.length < 5 || parts[0] !== "load") return;

  const idx = tonumber(parts[1]);
  if (idx !== WORKER_INDEX) return;

  const scriptName = parts[2];
  const nonce = parts[3] as unknown as uuid;
  const signature = parts[4];
  const targetId = key as unknown as uuid;

  // Verify signature: sign("load|" + idx + "|" + scriptName + "|" + nonce + "|" + targetObjectId)
  const expectedPayload = "load|" + parts[1] + "|" + scriptName + "|" + nonce + "|" + targetId;
  if (!verifyMessage(expectedPayload, signature)) return;

  const pin = derivePin(nonce);
  ll.RemoteLoadScriptPin(targetId, scriptName, pin, 1, 0);

  // Send done response
  const donePayload = "done|" + parts[1] + "|" + scriptName + "|" + targetId;
  const doneSig = signMessage(donePayload);

  ll.MessageLinked(LINK_THIS, workerChannel, "done|" + parts[1] + "|" + scriptName + "|" + doneSig, targetId);
});

LLEvents.on("on_rez", () => {
  workerChannel = computeWorkerChannel();
});

// Initialize channel on script start
workerChannel = computeWorkerChannel();
