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
  it.each(["bg-red-600 text-white hover:bg-red-700", "bg-emerald-600 hover:bg-emerald-700", "bg-destructive", "bg-[color:var(--accent)]", "bg-transparent"])("preserves caller background %s without covering it", (className) => {
    const c = getButtonClasses({ className });
    expect(c).toContain(className.split(" ")[0]);
    expect(c).not.toContain("bg-gradient-to-b");
    expect(c).not.toContain("from-primary");
    expect(c).not.toContain("to-primary-shade");
  });
  it.each(["hover:bg-red-700", "bg-clip-padding", "bg-cover"])("keeps the default gradient for non-base-colour utility %s", (className) => {
    expect(getButtonClasses({ className })).toContain("bg-gradient-to-b");
  });
  it("preserves a caller's own gradient stops while dropping variant stops", () => {
    const c = getButtonClasses({ className: "bg-red-600 bg-gradient-to-r from-red-600 to-red-700" });
    expect(c).toContain("bg-gradient-to-r from-red-600 to-red-700");
    expect(c).not.toContain("from-primary");
  });
  it("keeps the destructive gradient unless its background is overridden", () => {
    expect(getButtonClasses({ variant: "destructive" })).toContain("from-destructive");
    expect(getButtonClasses({ variant: "destructive", className: "bg-red-600" })).not.toContain("bg-gradient-to-b");
  });
});
