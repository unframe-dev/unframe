import type { SdkProgress as Progress } from "./tracking/progress";

const phases: Record<string, string> = {
  idle: "開始前",
  "engine-loading": "SDK読込中",
  "slam-loading": "SLAM読込中",
  "pipeline-starting": "カメラ・処理開始待ち",
  running: "カメラ開始済み",
  stopped: "停止",
  error: "起動エラー",
};
export function SdkProgress({ progress, nowMs }: { progress?: Progress; nowMs: number }) {
  if (!progress) return <p>SDK処理：開始前</p>;
  const elapsed =
    progress.lastUpdateAtMs === null ? null : Math.max(0, nowMs - progress.lastUpdateAtMs);
  return (
    <details className="sdk-progress" open>
      <summary>
        SDK処理：{phases[progress.phase] ?? "不明"} ／{" "}
        {progress.updates > 0 ? "更新受信あり" : "フレーム更新待ち"}
      </summary>
      <p>
        更新 {progress.updates}回 ／ 位置推定データ {progress.realityUpdates}回 ／ 有効な姿勢{" "}
        {progress.poseUpdates}回
      </p>
      <p>
        最終更新：{elapsed === null ? "未受信" : `${(elapsed / 1000).toFixed(1)}秒前`}
        {elapsed !== null && elapsed > 3000 ? "（更新が途切れています）" : ""}
      </p>
      <p>
        SDK生状態：{progress.rawStatus} ／ 理由：{progress.rawReason} ／ 状態イベント：
        {progress.eventStatus}
      </p>
      <p>
        モーション受信 {progress.sensors.motionEvents}回 ／ 向き受信{" "}
        {progress.sensors.orientationEvents}回
      </p>
      <p>
        加速度 {progress.sensors.accelerationAvailable ? "受信あり" : "有効値未受信"} ／ 角速度{" "}
        {progress.sensors.rotationRateAvailable ? "受信あり" : "有効値未受信"}
      </p>
      <p>受信回数は今回の開始からの累計です。未受信だけでは端末非対応とは判断できません。</p>
    </details>
  );
}
