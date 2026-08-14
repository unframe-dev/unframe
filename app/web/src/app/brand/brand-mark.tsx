export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none">
        <defs>
          <linearGradient id="unframe-brand-mark" x1="2" y1="5" x2="29" y2="28">
            <stop stopColor="#7187f5" />
            <stop offset="0.52" stopColor="#9a80d0" />
            <stop offset="1" stopColor="#df7b80" />
          </linearGradient>
        </defs>
        <path
          d="M4 9.5C9.2 4.2 15.3 4.4 20 9.1c4.6 4.7 5.2 10.2 8 13.4"
          stroke="url(#unframe-brand-mark)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M4 14.5c5.2-5.3 11.3-5.1 16 .2 4.6 4.7 5.2 10.2 8 13.4"
          stroke="url(#unframe-brand-mark)"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.72"
        />
        <path
          d="M4 19.5c5.2-5.3 11.3-5.1 16 .2 2.1 2.1 3.4 4.4 4.7 6.3"
          stroke="url(#unframe-brand-mark)"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.42"
        />
      </svg>
    </span>
  );
}
