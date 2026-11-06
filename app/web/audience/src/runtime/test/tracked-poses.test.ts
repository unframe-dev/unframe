import { expect, it } from "vite-plus/test";
import { mergeTrackedPoses, readTrackedPoses } from "../tracked-poses";

it("delivers a hand without an Anchor and expires duplicate samples without refreshing their age", () => {
  const pose = {
    target: 2,
    sample: { trackingFrameSequence: "7", observedAtRuntimeMonotonicMs: "100", position: { x: 3 } },
  };
  const first = mergeTrackedPoses([2], {}, [pose], true, {
    producedAtMilliseconds: 400,
    receivedAtMilliseconds: 1000,
  });
  expect(readTrackedPoses(first, 1200)[2]?.sample?.position?.x).toBe(3);
  const duplicate = mergeTrackedPoses([2], first, [pose], true, {
    producedAtMilliseconds: 450,
    receivedAtMilliseconds: 1150,
  });
  expect(readTrackedPoses(duplicate, 1201)[2]?.sample).toBeUndefined();
});

it("does not revive a pose after tracking is lost with an older or repeated sequence", () => {
  const timing = { producedAtMilliseconds: 100, receivedAtMilliseconds: 1000 };
  const sample = {
    target: 2,
    sample: { trackingFrameSequence: "7", observedAtRuntimeMonotonicMs: "100", position: { x: 3 } },
  };
  const first = mergeTrackedPoses([2], {}, [sample], true, timing);
  const lost = mergeTrackedPoses([2], first, [{ target: 2, unavailable: {} }], true, timing);
  const repeated = mergeTrackedPoses([2], lost, [sample], true, timing);
  expect(readTrackedPoses(repeated, 1000)[2]?.sample).toBeUndefined();
  const resumed = mergeTrackedPoses(
    [2],
    repeated,
    [{ ...sample, sample: { ...sample.sample, trackingFrameSequence: "8" } }],
    true,
    timing,
  );
  expect(readTrackedPoses(resumed, 1000)[2]?.sample?.position?.x).toBe(3);
  expect(readTrackedPoses(resumed, 1000)[2]?.continuity).not.toBe(
    readTrackedPoses(first, 1000)[2]?.continuity,
  );
});

it("rejects missing, duplicate, or unadvertised targets in a keyframe", () => {
  const timing = { producedAtMilliseconds: 0, receivedAtMilliseconds: 0 };
  expect(() => mergeTrackedPoses([2], {}, [], true, timing)).toThrow();
  expect(() =>
    mergeTrackedPoses(
      [2, 3],
      {},
      [
        { target: 2, unavailable: {} },
        { target: 2, unavailable: {} },
      ],
      true,
      timing,
    ),
  ).toThrow();
  expect(() =>
    mergeTrackedPoses([2], {}, [{ target: 3, unavailable: {} }], true, timing),
  ).toThrow();
});

it.each([
  { rotation: { w: 1 }, observedAtRuntimeMonotonicMs: "1000" },
  { position: { x: 2 }, observedAtRuntimeMonotonicMs: "499" },
])("records position discontinuity between rendered frames: %j", (interruption) => {
  const timing = { producedAtMilliseconds: 1000, receivedAtMilliseconds: 1000 };
  const first = mergeTrackedPoses(
    [2],
    {},
    [
      {
        target: 2,
        sample: {
          trackingFrameSequence: "1",
          observedAtRuntimeMonotonicMs: "1000",
          position: { x: 1 },
        },
      },
    ],
    true,
    timing,
  );
  const interrupted = mergeTrackedPoses(
    [2],
    first,
    [
      {
        target: 2,
        sample: {
          trackingFrameSequence: "2",
          ...interruption,
        },
      },
    ],
    true,
    timing,
  );
  const resumed = mergeTrackedPoses(
    [2],
    interrupted,
    [
      {
        target: 2,
        sample: {
          trackingFrameSequence: "3",
          observedAtRuntimeMonotonicMs: "1000",
          position: { x: 3 },
        },
      },
    ],
    true,
    timing,
  );
  expect(readTrackedPoses(resumed, 1000)[2]?.continuity).not.toBe(
    readTrackedPoses(first, 1000)[2]?.continuity,
  );
});
