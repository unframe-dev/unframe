import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { Button } from "../ui/button";
import { previewPositionSchema } from "@unframe-dev/contracts/author-http";

const coordinateLabel = (value: number) => String(Number(value.toFixed(3)));

function Coordinate({
  axis,
  value,
  disabled,
  onCommit,
  unit = "m",
}: {
  axis: string;
  unit?: string;
  value: number;
  disabled: boolean;
  onCommit(value: number): boolean;
}) {
  const [draft, setDraft] = useState(coordinateLabel(value));
  const [editing, setEditing] = useState(false);
  const changed = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(coordinateLabel(value));
  }, [value, editing]);
  return (
    <label className="presenter-coordinate">
      <span>{axis}</span>
      <input
        type="number"
        step="0.1"
        min={-3.4028234663852886e38}
        max={3.4028234663852886e38}
        aria-label={`Presenter ${axis} (${unit})`}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          changed.current = false;
          setEditing(true);
        }}
        onChange={(event) => {
          changed.current = true;
          setDraft(event.target.value);
        }}
        onBlur={(event) => {
          setEditing(false);
          const edited = changed.current;
          changed.current = false;
          const next = event.target.valueAsNumber;
          if (!edited || !Number.isFinite(next) || next === value || !onCommit(next))
            setDraft(coordinateLabel(value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            changed.current = false;
            event.currentTarget.value = coordinateLabel(value);
            setDraft(coordinateLabel(value));
          }
          if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function SpatialControls() {
  const workspace = useWorkspace();
  const { playback, status, view } = useStore(workspace.preview.store);
  const spatial = playback?.spatial;
  const pendingPosition = useRef<[number, number, number] | null>(null);
  useEffect(() => {
    if (
      !spatial ||
      pendingPosition.current?.every((value, index) => value === spatial.presenterPosition[index])
    )
      pendingPosition.current = null;
  }, [spatial]);
  useEffect(() => {
    pendingPosition.current = null;
  }, [playback?.state.requestId, status]);
  if (!spatial) return null;
  const disabled = status !== "ready" || playback.mode !== "normal";
  return (
    <div className="spatial-controls" role="toolbar" aria-label="Zone シミュレーション">
      <div className="spatial-view-controls" role="group" aria-label="Preview 視点">
        <Button
          aria-label="通常視点"
          aria-pressed={view === "perspective"}
          disabled={disabled}
          onClick={() => workspace.commands.previewView("perspective")}
        >
          通常
        </Button>
        <Button
          aria-label="俯瞰視点"
          aria-pressed={view === "overhead"}
          disabled={disabled}
          onClick={() => workspace.commands.previewView("overhead")}
        >
          俯瞰
        </Button>
        <Button disabled={disabled} onClick={() => workspace.commands.resetPreviewCamera()}>
          正面から見る
        </Button>
      </div>
      <div className="presenter-coordinates" role="group" aria-label="Presenter の腰位置">
        <span>Presenter (m)</span>
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <Coordinate
            key={axis}
            axis={axis}
            value={spatial.presenterPosition[index]!}
            disabled={disabled}
            onCommit={(value) => {
              const next = [...(pendingPosition.current ?? spatial.presenterPosition)] as [
                number,
                number,
                number,
              ];
              next[index] = value;
              const parsed = previewPositionSchema.safeParse(next);
              if (!parsed.success) return false;
              pendingPosition.current = parsed.data;
              workspace.commands.movePresenter(parsed.data);
              return true;
            }}
          />
        ))}
        <Coordinate
          axis="向き"
          unit="°"
          value={(() => {
            const [x, y, z, w] = spatial.presenterRotation ?? [0, 0, 0, 1];
            return (Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)) * 180) / Math.PI;
          })()}
          disabled={disabled}
          onCommit={(degrees) => {
            const half = ((degrees % 360) * Math.PI) / 360;
            workspace.commands.movePresenter(pendingPosition.current ?? spatial.presenterPosition, [
              0,
              Math.sin(half),
              0,
              Math.cos(half),
            ]);
            return true;
          }}
        />
      </div>
      <div className="spatial-zones" role="status" aria-label="Zone の内外">
        {spatial.zones.map((zone) => (
          <span
            key={zone.zoneId}
            className={`spatial-zone${zone.inside ? " spatial-zone-inside" : ""}${zone.active ? "" : " spatial-zone-inactive"}`}
            title={zone.active ? undefined : "現在の Step では判定対象外"}
          >
            {zone.zoneId} {zone.inside ? "内側" : "外側"}
          </span>
        ))}
      </div>
    </div>
  );
}
