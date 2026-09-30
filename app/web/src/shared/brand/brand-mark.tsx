import brandIconUrl from "./icon.svg?url";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 overflow-hidden"
      style={{ height: size, width: size }}
    >
      <img
        alt=""
        className="size-full object-contain"
        height={size}
        src={brandIconUrl}
        width={size}
      />
    </span>
  );
}
