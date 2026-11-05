import type { EffectConfiguration } from "@unframe-dev/contracts/presentation/effects";

export const effectRuntimeDuration = (
  effect: Pick<EffectConfiguration, "durationMilliseconds" | "speed">,
): number => {
  const duration = Math.ceil(effect.durationMilliseconds / effect.speed);
  if (!Number.isSafeInteger(duration) || duration < 1)
    throw new RangeError("Effect runtime duration exceeds the safe integer range.");
  return duration;
};
