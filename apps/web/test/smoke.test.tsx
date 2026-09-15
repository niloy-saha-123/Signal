import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Hello() {
  return <p>hello signal</p>;
}

describe("vitest + testing-library harness", () => {
  it("renders a component and applies jest-dom matchers", () => {
    render(<Hello />);
    expect(screen.getByText("hello signal")).toBeInTheDocument();
  });
});
