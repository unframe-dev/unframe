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
      /\.sidebar-collapse[^{}]*\{[^{}]*position: absolute;[^{}]*right: -22px;[^{}]*top: 38px;[^{}]*width: 44px;[^{}]*min-height: 44px/s,
    );
    expect(styles).toMatch(
      /\.app-sidebar[^{}]*\{[^{}]*z-index: 2;/s,
    );
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

  it("keeps motion for surfaces that enter and leave", () => {
    expect(styles).toMatch(
      /\.account-menu-popup\[data-starting-style\][^{}]*\{[^{}]*transform:/s,
    );
    expect(styles).toMatch(
      /\.dialog-popup\[data-starting-style\][^{}]*\{[^{}]*transform:/s,
    );
  });
});
