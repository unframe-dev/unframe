import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HomePage } from "./home-page";
it("guides users to the Host project instead of presenting mock documents", () => {
  render(<HomePage />);
  expect(screen.getByRole("heading", { name: "ローカル project を開く" })).toBeInTheDocument();
  expect(screen.getByText(/表示された Editor URL/)).toBeInTheDocument();
});
