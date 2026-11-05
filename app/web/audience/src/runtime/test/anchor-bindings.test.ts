import { expect, it } from "vite-plus/test";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import { mergeAnchorBindings, readAnchorBindings } from "../anchor-bindings";
const delivery: DeliveryManifestWire = {
  projectionProfile: {
    runtimeCatalog: {
      nodes: [
        {
          nodeId: "hand",
          container: {},
          parent: { presenterAnchor: { target: 2, followPosition: true } },
        },
      ],
    },
  },
};
const patch = {
  nodeId: "hand",
  sample: { trackingFrameSequence: "2", observedAtRuntimeMonotonicMs: "100", position: { x: 1 } },
};
it("keeps the newest valid hand pose and clears missing poses on a keyframe", () => {
  const bindings = mergeAnchorBindings(delivery, {}, [patch], true, {
    producedAtMilliseconds: 100,
    receivedAtMilliseconds: 0,
  });
  expect(
    mergeAnchorBindings(
      delivery,
      bindings,
      [{ ...patch, sample: { ...patch.sample, trackingFrameSequence: "1", position: { x: 9 } } }],
      false,
      { producedAtMilliseconds: 100, receivedAtMilliseconds: 0 },
    ),
  ).toEqual(bindings);
  expect(
    mergeAnchorBindings(delivery, bindings, [patch], true, {
      producedAtMilliseconds: 100,
      receivedAtMilliseconds: 0,
    }),
  ).toEqual(bindings);
  expect(
    mergeAnchorBindings(delivery, bindings, [], true, {
      producedAtMilliseconds: 100,
      receivedAtMilliseconds: 0,
    }),
  ).toEqual({});
});
it("rejects unknown anchors, nonfinite samples and missing required position", () => {
  expect(() =>
    mergeAnchorBindings(delivery, {}, [{ ...patch, nodeId: "unknown" }], true, {
      producedAtMilliseconds: 100,
      receivedAtMilliseconds: 0,
    }),
  ).toThrow();
  expect(() =>
    mergeAnchorBindings(
      delivery,
      {},
      [{ ...patch, sample: { ...patch.sample, position: { x: NaN } } }],
      true,
      { producedAtMilliseconds: 100, receivedAtMilliseconds: 0 },
    ),
  ).toThrow();
  expect(() =>
    mergeAnchorBindings(
      delivery,
      {},
      [{ nodeId: "hand", sample: { trackingFrameSequence: "1" } }],
      true,
      { producedAtMilliseconds: 100, receivedAtMilliseconds: 0 },
    ),
  ).toThrow();
});
it("expires samples after server age plus local monotonic age reaches 500 ms without refreshing duplicate packets", () => {
  const bindings = mergeAnchorBindings(delivery, {}, [patch], true, {
    producedAtMilliseconds: 400,
    receivedAtMilliseconds: 1000,
  });
  expect(readAnchorBindings(bindings, 1200).hand?.sample).toBeDefined();
  expect(readAnchorBindings(bindings, 1201).hand?.sample).toBeUndefined();
  const duplicate = mergeAnchorBindings(delivery, bindings, [patch], true, {
    producedAtMilliseconds: 450,
    receivedAtMilliseconds: 1150,
  });
  expect(readAnchorBindings(duplicate, 1201).hand?.sample).toBeUndefined();
});
it.each([99, 601])(
  "discards poses observed in the future or older than 500 ms at production (%s)",
  (producedAtMilliseconds) => {
    const bindings = mergeAnchorBindings(delivery, {}, [patch], true, {
      producedAtMilliseconds,
      receivedAtMilliseconds: 1000,
    });
    expect(readAnchorBindings(bindings, 1000).hand?.sample).toBeUndefined();
  },
);
