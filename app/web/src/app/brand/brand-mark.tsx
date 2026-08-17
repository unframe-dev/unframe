import brandIconUrl from "../../assets/brand/icon.svg?url";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      <img
        src={brandIconUrl}
        alt=""
        width={size}
        height={size}
        className="size-full object-contain"
      />
    </span>
  );
}
