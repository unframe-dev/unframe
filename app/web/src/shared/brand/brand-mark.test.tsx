import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./brand-mark";

describe("BrandMark", () => {
  it("renders the shared brand asset as a decorative image", () => {
    const { container } = render(<BrandMark size={34} />);
    const image = container.querySelector("img");

    expect(image).toHaveAttribute("src", expect.stringContaining("icon.svg"));
    expect(image).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
