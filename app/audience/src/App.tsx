import { lazy, Suspense } from "react";
import { AudienceApplication } from "./connection/AudienceApplication";
import "./styles.css";
import { isFixtureRoute, isTrackingRoute } from "./fixture-route";

const FixtureExperience = import.meta.env.DEV
  ? lazy(() =>
      import("./fixtures/FixtureExperience").then((module) => ({
        default: module.FixtureExperience,
      })),
    )
  : null;

const TrackingExperience = import.meta.env.DEV
  ? lazy(() =>
      import("./AnchorExperience").then((module) => ({ default: module.AnchorExperience })),
    )
  : null;

export function App() {
  if (FixtureExperience && isFixtureRoute(import.meta.env.DEV, window.location.search))
    return (
      <Suspense fallback={<p>テスト画面を準備しています。</p>}>
        <FixtureExperience />
      </Suspense>
    );
  if (TrackingExperience && isTrackingRoute(import.meta.env.DEV, window.location.search))
    return (
      <Suspense fallback={<p>位置合わせ画面を準備しています。</p>}>
        <TrackingExperience />
      </Suspense>
    );
  return <AudienceApplication />;
}
