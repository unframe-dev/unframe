const waveStart = {
  kind: "effect.start",
  owner: { kind: "group", groupId: "demo" },
  effect: {
    kind: "wave",
    size: 0.18,
    color: { red: 1, green: 1, blue: 1, alpha: 0.8 },
    speed: 1,
    durationMilliseconds: 4000,
    waveCycles: 1,
  },
} as const;

export const openingWaveStarts = [
  { ...waveStart, effectId: "opening-wave-left", nodeId: "opening-wave-left", seed: 0 },
  { ...waveStart, effectId: "opening-wave-right", nodeId: "opening-wave-right", seed: 1 },
  { ...waveStart, effectId: "opening-wave-top", nodeId: "opening-wave-top", seed: 2 },
  { ...waveStart, effectId: "opening-wave-bottom", nodeId: "opening-wave-bottom", seed: 3 },
] as const;

export const openingWaveStops = [
  { kind: "effect.stop", effectId: "opening-wave-left" },
  { kind: "effect.stop", effectId: "opening-wave-right" },
  { kind: "effect.stop", effectId: "opening-wave-top" },
  { kind: "effect.stop", effectId: "opening-wave-bottom" },
] as const;
