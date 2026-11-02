import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { MAX_SOURCE_IMAGE_BYTES, cropProfileImage, squareCrop } from "./profile-image";
import styles from "./profile-image-editor.module.css";

export function ProfileImageEditor({
  image,
  name,
  disabled,
  onChange,
}: {
  image: string;
  name: string;
  disabled: boolean;
  onChange: (image: Blob | null) => void;
}) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [failedImage, setFailedImage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={styles["editor"]}>
      <div className={styles["icon"]}>
        {image && image !== failedImage ? (
          <img src={image} alt="プロフィールアイコン" onError={() => setFailedImage(image)} />
        ) : (
          <span aria-label="プロフィールアイコン">
            {name.trim().charAt(0).toLocaleUpperCase() || "U"}
          </span>
        )}
      </div>
      <div className={styles["actions"]}>
        <input
          ref={input}
          className={styles["file"]}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="アイコン画像を選択"
          disabled={disabled}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            setError("");
            if (!selected) return;
            if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type)) {
              setError("PNG・JPEG・WebP画像を選択してください。");
            } else if (selected.size > MAX_SOURCE_IMAGE_BYTES) {
              setError("10MB以下の画像を選択してください。");
            } else setFile(selected);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          画像を変更
        </Button>
        {image ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setError("");
              onChange(null);
            }}
          >
            アイコンを解除
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={styles["error"]}>
          {error}
        </p>
      ) : null}
      {file ? (
        <ProfileImageCropper
          file={file}
          onCancel={() => setFile(undefined)}
          onError={(message) => {
            setError(message);
            setFile(undefined);
          }}
          onCrop={(blob) => {
            onChange(blob);
            setFile(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function ProfileImageCropper({
  file,
  onCancel,
  onError,
  onCrop,
}: {
  file: File;
  onCancel: () => void;
  onError: (message: string) => void;
  onCrop: (image: Blob) => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  const image = useRef<HTMLImageElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const crop = dimensions ? squareCrop(dimensions.width, dimensions.height, zoom, x, y) : undefined;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !dimensions || !crop) return;
    const displaySize = event.currentTarget.getBoundingClientRect().width;
    const scale = displaySize / crop.size;
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    if (dimensions.width > crop.size)
      setX(
        clamp(
          drag.current.startX -
            (2 * (event.clientX - drag.current.x)) / (scale * (dimensions.width - crop.size)),
        ),
      );
    if (dimensions.height > crop.size)
      setY(
        clamp(
          drag.current.startY -
            (2 * (event.clientY - drag.current.y)) / (scale * (dimensions.height - crop.size)),
        ),
      );
  };
  const confirm = async () => {
    if (!image.current || busy) return;
    setBusy(true);
    setError("");
    try {
      onCrop(await cropProfileImage(image.current, zoom, x, y));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画像を処理できませんでした。");
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles["backdrop"]} />
        <Dialog.Popup className={styles["popup"]}>
          <Dialog.Title className={styles["title"]}>画像を切り抜く</Dialog.Title>
          <Dialog.Description className={styles["description"]}>
            画像をドラッグして位置を調整
          </Dialog.Description>
          <div
            className={styles["crop"]}
            onPointerDown={(event) => {
              if (busy) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, startX: x, startY: y };
            }}
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <img
              ref={image}
              src={url || undefined}
              alt="切り抜きプレビュー"
              draggable={false}
              style={
                dimensions && crop
                  ? {
                      width: `${(dimensions.width / crop.size) * 100}%`,
                      height: `${(dimensions.height / crop.size) * 100}%`,
                      left: `${(-crop.x / crop.size) * 100}%`,
                      top: `${(-crop.y / crop.size) * 100}%`,
                    }
                  : { visibility: "hidden" }
              }
              onError={() => onError("画像を読み込めませんでした。別の画像を選択してください。")}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (!width || !height || width * height > 40_000_000) {
                  onError("4000万画素以下の画像を選択してください。");
                } else setDimensions({ width, height });
              }}
            />
            <div className={styles["cropMask"]} />
          </div>
          <div className={styles["sliders"]}>
            <label>
              拡大率
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                disabled={busy || !dimensions}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <label>
              左右の位置
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={x}
                disabled={busy || !dimensions || dimensions.width === crop?.size}
                onChange={(e) => setX(Number(e.target.value))}
              />
            </label>
            <label>
              上下の位置
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={y}
                disabled={busy || !dimensions || dimensions.height === crop?.size}
                onChange={(e) => setY(Number(e.target.value))}
              />
            </label>
          </div>
          {error ? (
            <p role="alert" className={styles["error"]}>
              {error}
            </p>
          ) : null}
          <div className={styles["dialogActions"]}>
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              キャンセル
            </Button>
            <Button type="button" disabled={busy || !dimensions} onClick={() => void confirm()}>
              {busy ? "処理中…" : "切り抜く"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
