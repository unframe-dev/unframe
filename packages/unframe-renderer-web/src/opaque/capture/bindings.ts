export type OpaqueBinding = {
  readonly disabled?: boolean | undefined;
  readonly height: number;
  readonly key: string;
  readonly text: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export const validateOpaqueBindings = (
  expected: Readonly<Record<string, string>>,
  observed: ReadonlyArray<OpaqueBinding>,
): { bindings: ReadonlyArray<OpaqueBinding>; ok: true } | { ok: false } => {
  if (Object.keys(expected).length !== observed.length) {
    return { ok: false };
  }
  const seen = new Set<string>();
  for (const item of observed) {
    if (
      seen.has(item.key) ||
      !Object.hasOwn(expected, item.key) ||
      item.text !== expected[item.key] ||
      ![item.x, item.y, item.width, item.height].every(Number.isFinite) ||
      item.width <= 0 ||
      item.height <= 0
    ) {
      return { ok: false };
    }
    seen.add(item.key);
  }
  return {
    bindings: [...observed].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    ok: true,
  };
};
