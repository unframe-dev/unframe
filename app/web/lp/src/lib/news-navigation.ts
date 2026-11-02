export type NewsSource = "home" | "news";

export function getNewsSource(value: string | null): NewsSource {
  return value === "home" ? "home" : "news";
}

export function getNewsBackNavigation(source: NewsSource): {
  href: string;
  label: string;
} {
  return source === "home"
    ? { href: "/", label: "ホームに戻る" }
    : { href: "/news/", label: "ニュースに戻る" };
}
