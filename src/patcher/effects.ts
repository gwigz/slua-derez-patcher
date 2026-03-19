const WHITE = Vector.one;

/** Shows floating text above the patcher prim. */
export function setStatus(text: string) {
  ll.SetText(text, WHITE, 1.0);
}

/** Hides the floating text. */
export function clearStatus() {
  ll.SetText("", Vector.zero, 0);
}

/** Emits a particle beam toward the target object being patched. */
export function startParticles(targetId: uuid) {
  ll.ParticleSystem([
    PSYS_SRC_PATTERN,
    PSYS_SRC_PATTERN_ANGLE_CONE_EMPTY,
    PSYS_SRC_TARGET_KEY,
    targetId,
    PSYS_SRC_TEXTURE,
    "1d8f5508-86ae-4131-9044-dbb9d06d3385",
    PSYS_PART_START_COLOR,
    new Vector(1, 1, 1),
    PSYS_PART_START_ALPHA,
    1,
    PSYS_PART_START_SCALE,
    new Vector(0.125, 0.125, 0),
    PSYS_SRC_MAX_AGE,
    0,
    PSYS_PART_MAX_AGE,
    3.1,
    PSYS_SRC_BURST_RATE,
    3.1,
    PSYS_SRC_BURST_PART_COUNT,
    1,
    PSYS_PART_FLAGS,
    PSYS_PART_EMISSIVE_MASK | PSYS_PART_FOLLOW_SRC_MASK | PSYS_PART_TARGET_LINEAR_MASK,
  ]);
}

/** Stops the particle beam. */
export function stopParticles() {
  ll.ParticleSystem([]);
}
