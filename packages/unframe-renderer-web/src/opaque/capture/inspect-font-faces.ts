export type Face = {
  family: string;
  weight: string;
  style: string;
  sources: readonly string[];
};

/** Self-contained because CDP evaluates this function in an isolated browser world. */
export const inspectFontFaces = () => {
  const faces: (Face & { validSource: boolean })[] = [];
  const activeMedia = (media: MediaList) => !media.mediaText || matchMedia(media.mediaText).matches;
  const visit = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        if (
          rule.styleSheet &&
          activeMedia(rule.media) &&
          (!rule.supportsText || CSS.supports(rule.supportsText))
        )
          visit(rule.styleSheet.cssRules);
      } else if (rule instanceof CSSMediaRule) {
        if (activeMedia(rule.media)) visit(rule.cssRules);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) visit(rule.cssRules);
      } else if (rule instanceof CSSLayerBlockRule) {
        visit(rule.cssRules);
      } else if (rule instanceof CSSFontFaceRule) {
        const src = rule.style.getPropertyValue("src");
        const sources = [...src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)].map(
          (match) =>
            new URL(
              match[1] ?? match[2] ?? match[3] ?? "",
              rule.parentStyleSheet?.href ?? document.baseURI,
            ).href,
        );
        faces.push({
          family: rule.style
            .getPropertyValue("font-family")
            .trim()
            .replace(/^["']|["']$/g, ""),
          weight: rule.style.getPropertyValue("font-weight").trim() || "normal",
          style: rule.style.getPropertyValue("font-style").trim() || "normal",
          sources,
          validSource:
            sources.length > 0 &&
            !/local\s*\(/i.test(src) &&
            (src.match(/url\s*\(/gi) ?? []).length === sources.length,
        });
      }
    }
  };
  for (const sheet of document.styleSheets) {
    if (!sheet.disabled && activeMedia(sheet.media)) visit(sheet.cssRules);
  }
  return {
    faces,
    registered: [...document.fonts].map((face) => ({
      family: face.family.replace(/^["']|["']$/g, ""),
      weight: face.weight,
      style: face.style,
      status: face.status,
    })),
  };
};
