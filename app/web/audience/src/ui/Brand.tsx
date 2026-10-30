import icon from "./brand/icon.svg";

export function Brand({ onHome }: { onHome?(): void } = {}) {
  const content = (
    <>
      <img src={icon} width="36" height="36" alt="" />
      <span>Unframe</span>
    </>
  );
  return onHome ? (
    <button
      type="button"
      className="audience-brand"
      onClick={onHome}
      aria-label="unframe Audience ホーム"
    >
      {content}
    </button>
  ) : (
    <a className="audience-brand" href="/" aria-label="unframe Audience ホーム">
      {content}
    </a>
  );
}
