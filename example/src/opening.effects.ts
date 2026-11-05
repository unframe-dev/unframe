const waveStart = {
  kind: "effect.start",
  owner: { kind: "group", groupId: "demo" },
  effect: {
    kind: "wave",
    size: 0.48,
    color: { red: 1, green: 1, blue: 1, alpha: 0.8 },
    speed: 1,
    durationMilliseconds: 1200,
    waveCycles: 1,
  },
} as const;

export const openingWaveStarts = [
  {
    ...waveStart,
    effectId: "opening-wave-bottom-left",
    nodeId: "opening-wave-bottom-left",
    seed: 0,
  },
  { ...waveStart, effectId: "opening-wave-top-right", nodeId: "opening-wave-top-right", seed: 1 },
] as const;

export const openingWaveStops = [
  { kind: "effect.stop", effectId: "opening-wave-bottom-left" },
  { kind: "effect.stop", effectId: "opening-wave-top-right" },
] as const;
