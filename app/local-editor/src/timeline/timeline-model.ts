export const timePosition = (time: number, duration: number) =>
  duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
export const timeAtPosition = (position: number, width: number, duration: number) =>
  width > 0 ? Math.round(Math.max(0, Math.min(1, position / width)) * duration) : 0;
