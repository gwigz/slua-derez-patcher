import { getObjectNames, getItemsForObject } from "./inventory";

/**
 * Handles the `patch` command.
 *
 * When target is `"all"`, scans inventory for every object that has matching
 * scripts or items and queues them all. Otherwise validates that the named
 * object exists in inventory and queues it alone.
 */
export function handlePatch(
  selfName: string,
  target: string,
  startPatching: (queue: string[]) => void,
) {
  if (target === "all") {
    const queue: string[] = [];

    for (const obj of getObjectNames()) {
      const { scripts, items } = getItemsForObject(selfName, obj);

      if (scripts.length > 0 || items.length > 0) {
        queue.push(obj);
      }
    }

    if (queue.length === 0) {
      ll.OwnerSay("No patchable objects found, aborting.");
      return;
    }

    startPatching(queue);
  } else {
    if (ll.GetInventoryType(target) !== INVENTORY_OBJECT) {
      ll.OwnerSay('Object "' + target + '" not found in inventory.');
      return;
    }

    startPatching([target]);
  }
}
