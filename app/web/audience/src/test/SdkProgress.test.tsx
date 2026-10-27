// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SdkProgress } from "../SdkProgress";
afterEach(cleanup);
test("カメラ開始と実際のSDK更新受信を区別し、更新停止も表示する", () => {
  const progress = {
    phase: "running",
    updates: 0,
    realityUpdates: 0,
    poseUpdates: 0,
    lastUpdateAtMs: null,
    rawStatus: "未取得",
    rawReason: "未取得",
    eventStatus: "未取得",
    sensors: {
      motionEvents: 0,
      orientationEvents: 0,
      accelerationAvailable: false,
      rotationRateAvailable: false,
      orientationAvailable: false,
      lastMotionAtMs: null,
      lastOrientationAtMs: null,
    },
  };
  const { rerender } = render(<SdkProgress progress={progress} nowMs={5000} />);
  expect(screen.getByText(/カメラ開始済み.*フレーム更新待ち/)).toBeTruthy();
  rerender(
    <SdkProgress
      progress={{
        ...progress,
        updates: 5,
        realityUpdates: 5,
        lastUpdateAtMs: 1000,
        rawStatus: "LIMITED",
        rawReason: "INITIALIZING",
      }}
      nowMs={5000}
    />,
  );
  expect(screen.getByText(/更新が途切れています/)).toBeTruthy();
  expect(screen.getByText(/LIMITED.*INITIALIZING/)).toBeTruthy();
});
