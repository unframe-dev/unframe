import brandIconUrl from "./icon.svg?url";

export function BrandMark() {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 overflow-hidden">
      <img src={brandIconUrl} alt="" width={32} height={32} className="size-full object-contain" />
    </span>
  );
}
