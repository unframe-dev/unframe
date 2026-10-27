import { useEffect, useRef, useState, type ReactNode } from "react";
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
function MenuSheet({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="audience-stage__scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className="audience-stage__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="視聴メニュー"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key !== "Tab") return;
          const items = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href], select:not(:disabled), input:not(:disabled), summary",
            ) ?? [],
          ).filter((item) => item.getClientRects().length > 0);
          const first = items[0],
            last = items.at(-1);
          if (!first) {
            event.preventDefault();
            return;
          }
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === ref.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === ref.current)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header>
          <h2>視聴メニュー</h2>
          <button className="audience-stage__icon-button" onClick={onClose} aria-label="閉じる">
            <Icon kind="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function AudienceStage({
  phase,
  normal = false,
  warmupSeconds = 5,
  onStart,
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
      <header className="audience-stage__topbar">
        {immersive ? (
          <span className="audience-stage__status">
            <i />
            {phase === "scanning" ? "位置合わせ" : phase === "waiting" ? "配信待ち" : viewingLabel}
          </span>
        ) : (
          <a className="audience-stage__brand" href="/">
            unframe <span>AUDIENCE</span>
          </a>
        )}
        <button
          className="audience-stage__icon-button"
          aria-label="メニューを開く"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon kind="menu" />
        </button>
      </header>
      {phase === "permission" && (
        <section className="audience-stage__card">
          <span className="audience-stage__step">02 / CAMERA</span>
          <div className="audience-stage__camera-icon">
            <Icon kind="camera" />
          </div>
          <h1>会場の空間へ。</h1>
          <p>
            カメラを使って、目の前の空間に
            <br />
            プレゼンテーションを表示します。
          </p>
          <button className="audience-stage__primary" disabled={!canStart} onClick={onStart}>
            {startLabel}
            <Icon kind="arrow" />
          </button>
          <small>続けるにはカメラの使用を許可してください。</small>
          {notice}
        </section>
      )}
      {phase === "sdk" && (
        <section className="audience-stage__card audience-stage__preparing" role="status">
          <span className="audience-stage__step">02 / PREPARING</span>
          <div className="audience-stage__orbit" aria-hidden="true">
            <span />
          </div>
          <h1>空間を準備しています</h1>
          <p>
            周囲の床や机を映しながら、
            <br />
            スマートフォンをゆっくり動かしてください。
          </p>
          <div className="audience-stage__progress">
            <span
              style={{
                width: normal
                  ? `${Math.max(8, Math.min(100, ((5 - warmupSeconds) / 5) * 100))}%`
                  : "24%",
              }}
            />
          </div>
          <span className="audience-stage__waiting-label">
            {normal
              ? warmupSeconds > 0
                ? `SDK NORMAL · 安定を確認中 ${Math.ceil(warmupSeconds)}秒`
                : "SDK NORMAL · マーカー認識を準備中"
              : "SDK NORMAL 待ち · カメラ・追跡を準備中"}
          </span>
          <small>準備ができると、自動で位置合わせに進みます。</small>
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
          <span className="audience-stage__step">THANK YOU</span>
          <h1>ご視聴ありがとうございました</h1>
          <p>プレゼンテーションは終了しました。</p>
          <a className="audience-stage__primary" href="/">
            ルーム入力へ戻る
            <Icon kind="arrow" />
          </a>
        </section>
      )}
      {phase === "error" && (
        <section className="audience-stage__card">
          <span className="audience-stage__step">CONNECTION</span>
          <h1>もう一度お試しください</h1>
          <p role="alert">{error ?? "カメラや通信の状態を確認してください。"}</p>
          <button className="audience-stage__primary" disabled={!canStart} onClick={onStart}>
            再試行
            <Icon kind="arrow" />
          </button>
        </section>
      )}
      {children}
      {menuOpen && (
        <MenuSheet onClose={() => setMenuOpen(false)}>
          {menu ?? <p>追加の操作はありません。</p>}
        </MenuSheet>
      )}
    </div>
  );
}
