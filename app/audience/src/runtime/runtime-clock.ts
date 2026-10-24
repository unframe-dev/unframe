import type { ParticipantRuntimeView } from "@unframe/contracts/presentation";

type RuntimeClock = ParticipantRuntimeView["clock"];

export function createRuntimeClock(now: () => number = () => performance.now()) {
  let sample: RuntimeClock | null = null;
  let receivedAt = 0;
  return {
    synchronize(clock: RuntimeClock) {
      if (!Number.isSafeInteger(clock.runtimeTimeMilliseconds) || clock.runtimeTimeMilliseconds < 0)
        throw new Error("Invalid runtime clock");
      if (
        sample?.runtimeTimeMilliseconds === clock.runtimeTimeMilliseconds &&
        JSON.stringify(sample.lifecycle) === JSON.stringify(clock.lifecycle)
      )
        return;
      sample = structuredClone(clock);
      receivedAt = now();
    },
    read(): number | null {
      if (!sample) return null;
      return (
        sample.runtimeTimeMilliseconds +
        (sample.lifecycle.kind === "running" ? Math.max(0, now() - receivedAt) : 0)
      );
    },
    reset() {
      sample = null;
    },
  };
}
