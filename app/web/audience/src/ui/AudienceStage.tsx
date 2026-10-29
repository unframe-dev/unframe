import { useState, type ReactNode } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import { Brand } from "./Brand";
import type { ViewingPhase } from "./viewing-phase";
import "./audience-stage.css";

function Icon({ kind }: { kind: "menu" | "close" | "camera" | "arrow" }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "menu" ? (
        <>
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="19" r="1" />
        </>
      ) : kind === "close" ? (
        <path d="m6 6 12 12M6 18 18 6" />
      ) : kind === "camera" ? (
        <>
          <path d="M4 7h4l2-3h4l2 3h4v13H4z" />
          <circle cx="12" cy="13" r="4" />
        </>
      ) : (
        <path d="M5 12h14m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}
export function AudienceStage({
  phase,
  normal = false,
  warmupSeconds = 5,
  onStart,
  onLeave,
  canStart,
  startLabel = "カメラを開始",
  menu,
  error,
  notice,
  viewingLabel = "視聴中",
  waitingLabel = "位置合わせができました",
  waitingMessage = "プレゼンテーションを待っています。",
  children,
}: {
  phase: ViewingPhase;
  normal?: boolean;
  warmupSeconds?: number;
  onStart(): void;
  onLeave?(): void;
  canStart: boolean;
  startLabel?: string;
  menu?: ReactNode;
  error?: string | null;
  notice?: ReactNode;
  viewingLabel?: string;
  waitingLabel?: string;
  waitingMessage?: string;
  children?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const immersive = phase === "viewing" || phase === "scanning" || phase === "waiting";
  return (
    <div className={`audience-stage audience-stage--${phase}`} data-phase={phase}>
      <header className="audience-stage__topbar flex w-full items-center justify-between gap-4">
        {immersive ? (
          <span className="audience-stage__status" role="status">
            <i aria-hidden="true" />
            {phase === "scanning" ? "位置合わせ" : phase === "waiting" ? "配信待ち" : viewingLabel}
          </span>
        ) : (
          <Brand {...(onLeave ? { onHome: onLeave } : {})} />
        )}
        <IconButton
          className="audience-stage__menu-trigger"
          aria-label="メニューを開く"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon kind="menu" />
        </IconButton>
      </header>
      {phase === "permission" && (
        <section className="audience-stage__card">
          <div className="audience-stage__camera-icon">
            <Icon kind="camera" />
          </div>
          <h1>カメラを使って視聴</h1>
          <p>目の前の空間にプレゼンテーションを表示します。カメラの使用を許可してください。</p>
          <Button fullWidth variant="contained" disabled={!canStart} onClick={onStart}>
            {startLabel}
          </Button>
          {notice}
        </section>
      )}
      {phase === "sdk" && (
        <section className="audience-stage__card audience-stage__preparing" role="status">
          <h1>空間を準備しています</h1>
          <p>周囲の床や机を映しながら、スマートフォンをゆっくり動かしてください。</p>
          <LinearProgress
            aria-label="空間の準備"
            variant={normal ? "determinate" : "indeterminate"}
            value={Math.max(0, Math.min(100, ((5 - warmupSeconds) / 5) * 100))}
          />
          <p className="audience-stage__waiting-label">
            {normal
              ? warmupSeconds > 0
                ? `追跡の安定を確認中 ${Math.ceil(warmupSeconds)}秒`
                : "マーカーの認識を準備しています。"
              : "カメラと追跡を開始しています。"}
          </p>
        </section>
      )}
      {phase === "scanning" && (
        <>
          <div className="audience-stage__reticle" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="audience-stage__scan-hint" role="status">
            <strong>会場のマーカーを映してください</strong>
            <span>全体が映る位置で、少しの間止めます。</span>
          </div>
        </>
      )}
      {phase === "waiting" && (
        <div className="audience-stage__scan-hint" role="status">
          <strong>{waitingLabel}</strong>
          <span>{waitingMessage}</span>
        </div>
      )}
      {phase === "ended" && (
        <section className="audience-stage__card">
          <h1>ご視聴ありがとうございました</h1>
          <p>プレゼンテーションは終了しました。</p>
          <Button fullWidth variant="contained" onClick={onLeave} disabled={!onLeave}>
            ルーム入力へ戻る
          </Button>
        </section>
      )}
      {phase === "error" && (
        <section className="audience-stage__card">
          <h1>もう一度お試しください</h1>
          <p role="alert">{error ?? "カメラや通信の状態を確認してください。"}</p>
          <Button fullWidth variant="contained" disabled={!canStart} onClick={onStart}>
            再試行
          </Button>
        </section>
      )}
      {children}
      <Dialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        aria-labelledby="audience-menu-title"
        fullWidth
        maxWidth="sm"
        slotProps={{ paper: { className: "audience-stage__sheet" } }}
        transitionDuration={0}
      >
        <DialogTitle id="audience-menu-title" className="flex items-center justify-between gap-3">
          視聴メニュー
          <IconButton onClick={() => setMenuOpen(false)} aria-label="閉じる">
            <Icon kind="close" />
          </IconButton>
        </DialogTitle>
        <DialogContent>{menu ?? <p>追加の操作はありません。</p>}</DialogContent>
      </Dialog>
    </div>
  );
}
