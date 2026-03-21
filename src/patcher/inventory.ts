/**
 * Matches an object name against a wildcard pattern.
 *
 * Supported patterns:
 *   `"*"`        Matches everything
 *   `"prefix*"`  Matches names starting with prefix
 *   `"*suffix"`  Matches names ending with suffix
 *   `"exact"`    Matches the exact name (no wildcard)
 */
export function wildcardMatches(objectName: string, pattern: string) {
  if (pattern === "*") {
    return true;
  }

  const starIdx = pattern.indexOf("*");

  if (starIdx < 0) {
    return objectName === pattern;
  }

  if (starIdx === 0) {
    const suffix = pattern.substring(1);

    return (
      objectName.length >= suffix.length &&
      objectName.substring(objectName.length - suffix.length) === suffix
    );
  }

  return objectName.startsWith(pattern.substring(0, starIdx));
}

/**
 * Matches an object name against one or more comma-separated wildcard
 * patterns. Returns true if any pattern matches.
 */
export function patternMatches(objectName: string, pattern: string) {
  if (pattern.includes(",")) {
    for (const part of pattern.split(",")) {
      if (wildcardMatches(objectName, part)) return true;
    }

    return false;
  }

  return wildcardMatches(objectName, pattern);
}

/**
 * Checks whether an inventory item targets the given object.
 *
 * Items use a naming convention with a `/` separator:
 *   `"ObjectName/script"`    Exact match on object name
 *   `"{pattern}/script"`     Wildcard or comma pattern match
 *
 * Returns false for items without a `/` separator.
 */
export function matchesObject(name: string, objectName: string) {
  const slashIdx = name.indexOf("/");

  if (slashIdx < 0) {
    return false;
  }

  const prefix = name.substring(0, slashIdx);

  if (prefix === objectName) {
    return true;
  }

  if (prefix.startsWith("{") && prefix.indexOf("}") === prefix.length - 1) {
    return patternMatches(objectName, prefix.substring(1, prefix.length - 1));
  }

  return false;
}

/** Returns the names of all object-type items in the prim's inventory. */
export function getObjectNames() {
  const names: string[] = [];
  const count = ll.GetInventoryNumber(INVENTORY_OBJECT);

  for (let i = 0; i < count; i++) {
    names.push(ll.GetInventoryName(INVENTORY_OBJECT, i));
  }

  return names;
}

/**
 * Collects all inventory items targeting the given object, separated into
 * scripts and non-script items. Excludes the patcher script itself and
 * any object-type inventory entries.
 */
export function getItemsForObject(selfName: string, objectName: string) {
  const scripts: string[] = [];
  const items: string[] = [];
  const count = ll.GetInventoryNumber(INVENTORY_ALL);

  for (let i = 0; i < count; i++) {
    const name = ll.GetInventoryName(INVENTORY_ALL, i);
    const itemType = ll.GetInventoryType(name);

    if (name !== selfName && itemType !== INVENTORY_OBJECT) {
      if (matchesObject(name, objectName)) {
        if (itemType === INVENTORY_SCRIPT) {
          scripts.push(name);
        } else {
          items.push(name);
        }
      }
    }
  }

  return { scripts, items };
}

/** Strips the `ObjectName/` prefix, returning just the item's own name. */
export function targetItemName(fullName: string) {
  const idx = fullName.indexOf("/");

  return idx < 0 ? fullName : fullName.substring(idx + 1);
}

/** Inventory type constant -> short human-readable label. */
const TYPE_LABELS: Record<number, string> = {
  [INVENTORY_SCRIPT]: "script",
  [INVENTORY_TEXTURE]: "texture",
  [INVENTORY_SOUND]: "sound",
  [INVENTORY_LANDMARK]: "landmark",
  [INVENTORY_NOTECARD]: "notecard",
  [INVENTORY_ANIMATION]: "animation",
  [INVENTORY_GESTURE]: "gesture",
  [INVENTORY_CLOTHING]: "clothing",
  [INVENTORY_BODYPART]: "body part",
  [INVENTORY_SETTING]: "setting",
  [INVENTORY_MATERIAL]: "material",
};

/** Returns a short human-readable label for an inventory type constant. */
export function inventoryTypeLabel(itemType: number) {
  return TYPE_LABELS[itemType] || "item";
}
