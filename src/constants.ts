/** Shared secret for signing dynamic script access pins. */
export const SECRET = "slua-derez-patcher";

/** Internal channel for patcher/bootstrap protocol messages. */
export const COMM_CHANNEL = -47123;

/** Owner chat channel for commands (patcher only). */
export const CMD_CHANNEL = 7;

/** Protocol version, included in the "pinned" handshake. */
export const VERSION = "v0.1.0";

/** Inventory name of the bootstrap script for auto-upgrade. */
export const BOOTSTRAP_NAME = "bootstrap";
