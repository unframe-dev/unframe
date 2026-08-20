import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buttonVariants } from "./components/ui/button";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("interaction motion", () => {
  it("uses the favicon coral as the primary interaction color", () => {
    expect(styles).toContain("--brand-red: #df7b80");
    expect(styles).toContain("--primary: var(--brand-red)");
    expect(styles).not.toContain("--brand-purple");
  });

  it("keeps the canvas white and uses blue for secondary interaction feedback", () => {
    expect(styles).toContain("--background: #fff");
    expect(styles).toContain("--interactive-blue: #526ee8");
    expect(styles).not.toContain(".app-shell::before");
    expect(styles).toMatch(/\.workspace-surface[^{}]*\{[^{}]*border: 0;/s);
  });

  it("moves application chrome into a full-height sidebar", () => {
    expect(styles).not.toMatch(/\.app-header[^{}]*\{/s);
    expect(styles).toMatch(
      /\.app-layout[^{}]*\{[^{}]*width: 100%;[^{}]*min-height: 100dvh;[^{}]*grid-template-columns: 248px minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /\.app-sidebar[^{}]*\{[^{}]*display: flex;[^{}]*height: 100dvh;[^{}]*flex-direction: column;/s,
    );
    expect(styles).toMatch(/\.sidebar-account[^{}]*\{[^{}]*margin-top: auto;/s);
  });

  it("uses the wider desktop canvas for presentation cards", () => {
    expect(styles).toMatch(
      /@media \(min-width: 1024px\)[^]*?\.app-layout[^{}]*\{[^{}]*grid-template-columns: 248px minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /@media \(min-width: 1024px\)[^]*?\.workspace-main[^{}]*\{[^{}]*width: min\(100% - 144px, 1296px\);/s,
    );
    expect(styles).toMatch(/\.workspace-main[^{}]*\{[^{}]*width: min\(100% - 80px, 1440px\);/s);
    expect(styles).toMatch(
      /\.presentation-grid[^{}]*\{[^{}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 300px\), 1fr\)\);/s,
    );
  });

  it("places the presentation workspace closer to the header", () => {
    expect(styles).toMatch(/\.workspace-main[^{}]*\{[^{}]*padding-top: 0;/s);
    expect(styles).toMatch(/\.workspace-title[^{}]*\{[^{}]*margin-top: -28px;/s);
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[^]*?\.workspace-title[^{}]*\{[^{}]*margin-top: 0;/s,
    );
  });

  it("uses a restrained presentation heading size", () => {
    expect(styles).toMatch(
      /\.workspace-title h1[^{}]*\{[^{}]*font-size: clamp\(3rem, 6vw, 5\.75rem\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[^]*?\.workspace-title h1[^{}]*\{[^{}]*font-size: clamp\(2\.8rem, 14vw, 3\.75rem\);/s,
    );
  });

  it("uses the landing page brand gradient for the presentation heading", () => {
    expect(styles).toMatch(
      /\.workspace-title h1[^{}]*\{[^{}]*width: fit-content;[^{}]*background: linear-gradient\(\s*100deg,\s*var\(--brand-blue\),\s*#9a80d0 48%,\s*var\(--brand-red\)\s*\);[^{}]*background-clip: text;[^{}]*-webkit-background-clip: text;[^{}]*color: transparent;/s,
    );
  });

  it("places search and creation actions on the same row", () => {
    expect(styles).toMatch(/\.workspace-header[^{}]*\{[^{}]*display: grid;[^{}]*gap: 28px;/s);
    expect(styles).toMatch(
      /\.workspace-actions[^{}]*\{[^{}]*display: flex;[^{}]*width: 100%;[^{}]*align-items: flex-start;[^{}]*justify-content: space-between;[^{}]*gap: 24px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[^]*?\.workspace-actions[^{}]*\{[^{}]*width: 100%;[^{}]*align-items: stretch;[^{}]*flex-direction: column;/s,
    );
  });

  it("uses an iridescent underline with a stronger focus gradient", () => {
    expect(styles).toMatch(/\.workspace-actions \.search[^{}]*\{[^{}]*width: min\(100%, 480px\);/s);
    expect(styles).toMatch(
      /\.search[^{}]*\{[^{}]*position: relative;[^{}]*min-height: 52px;[^{}]*border: 0;[^{}]*border-radius: 0;[^{}]*background: transparent;/s,
    );
    expect(styles).toMatch(
      /\.search::after[^{}]*\{[^{}]*height: 1px;[^{}]*linear-gradient\([^{}]*color-mix\(in srgb, var\(--brand-blue\) 28%, #fff\)[^{}]*content: "";/s,
    );
    expect(styles).toMatch(
      /\.search:focus-within::after[^{}]*\{[^{}]*height: 2px;[^{}]*linear-gradient\(\s*100deg,\s*var\(--brand-blue\),\s*#9a80d0 48%,\s*var\(--brand-red\)\s*\);/s,
    );
    expect(styles).toMatch(
      /\.search input:focus[^{}]*\{[^{}]*border-color: transparent;[^{}]*box-shadow: none;/s,
    );
  });

  it("uses the brand coral for the account menu selection", () => {
    expect(styles).toMatch(
      /\.account-menu-item\[data-highlighted\],[^{}]*\.account-menu-item\[aria-current="page"\][^{}]*\{[^{}]*color: var\(--accent-ink\);[^{}]*background: var\(--accent\);/s,
    );
  });

  it("changes only foreground colors when hovering sidebar controls", () => {
    expect(styles).toMatch(
      /\.sidebar-link:hover[^{}]*\{[^{}]*color: var\(--interactive-blue-ink\);[^{}]*background: transparent;/s,
    );
    expect(styles).toMatch(
      /\.sidebar-collapse:hover[^{}]*\{[^{}]*color: var\(--foreground\);[^{}]*background: transparent;/s,
    );
    expect(styles).toMatch(
      /\.sidebar-back:hover[^{}]*\{[^{}]*color: var\(--foreground\);[^{}]*background: transparent;/s,
    );
    expect(styles).toMatch(
      /\.sidebar-collapse:focus-visible[^{}]*\{[^{}]*outline-color: var\(--brand-red\);/s,
    );
  });

  it("places the collapse control on the sidebar edge without taking a row", () => {
    expect(styles).toMatch(
      /\.sidebar-collapse[^{}]*\{[^{}]*position: absolute;[^{}]*right: -22px;[^{}]*top: 24px;[^{}]*width: 44px;[^{}]*min-height: 44px/s,
    );
    expect(styles).toMatch(/\.app-sidebar[^{}]*\{[^{}]*z-index: 2;/s);
    expect(styles).toMatch(
      /\.sidebar-collapse::before[^{}]*\{[^{}]*inset: 4px;[^{}]*border-radius: 999px;/s,
    );
  });

  it("does not move buttons or hover targets", () => {
    expect(buttonVariants()).not.toMatch(/translate|scale|rotate|transform/);
    expect(styles).not.toMatch(/:hover[^{}]*\{[^{}]*transform:/s);
    expect(styles).not.toMatch(/:active[^{}]*\{[^{}]*transform:/s);
    expect(styles).not.toMatch(/:focus-within[^{}]*\{[^{}]*transform:/s);
  });

  it("places presentation titles over a faded thumbnail backdrop", () => {
    expect(styles).toMatch(
      /\.presentation-thumbnail::after[^{}]*\{[^{}]*height: 58%;[^{}]*linear-gradient\(\s*to top,\s*rgb\(17 19 24 \/ 84%\)[^{}]*transparent\s*\);/s,
    );
    expect(styles).toMatch(
      /\.presentation-card h2[^{}]*\{[^{}]*position: absolute;[^{}]*inset: auto 18px 16px;[^{}]*color: #fff;[^{}]*font-size: 0\.95rem;[^{}]*font-weight: 600;[^{}]*text-shadow: 0 1px 3px rgb\(0 0 0 \/ 48%\);/s,
    );
  });

  it("does not add a colored border when hovering a presentation", () => {
    expect(styles).not.toMatch(
      /\.presentation-card:hover \.presentation-thumbnail[^{}]*\{[^{}]*border-color:/s,
    );
  });

  it("keeps motion for surfaces that enter and leave", () => {
    expect(styles).toMatch(/\.account-menu-popup\[data-starting-style\][^{}]*\{[^{}]*transform:/s);
    expect(styles).toMatch(/\.dialog-popup\[data-starting-style\][^{}]*\{[^{}]*transform:/s);
  });
});
