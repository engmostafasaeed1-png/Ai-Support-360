import { describe, it, expect } from "vitest";
import { buttonVariants, getButtonClasses } from "./button";

describe("button variants", () => {
  it("primary has gradient and soft shadow", () => {
    const c = buttonVariants({});
    expect(c).toContain("bg-gradient-to-b");
    expect(c).toContain("shadow-primary/25");
  });
  it("outline uses the border token", () => {
    expect(buttonVariants({ variant: "outline" })).toContain("border-border");
  });
  it("disabled removes shadow and transform", () => {
    const c = buttonVariants({});
    expect(c).toContain("disabled:shadow-none");
    expect(c).toContain("disabled:transform-none");
  });
  it("respects reduced motion", () => {
    const c = buttonVariants({ variant: "ghost" });
    expect(c).toContain("motion-reduce:transition-none");
    expect(c).toContain("motion-reduce:transform-none");
  });
  it("skips own gradient when gradient-primary is passed", () => {
    const c = getButtonClasses({ className: "gradient-primary border-0" });
    expect(c).toContain("gradient-primary");
    expect(c).not.toContain("bg-gradient-to-b");
  });
});
