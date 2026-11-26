import { describe, expect, it } from "vitest";
import { cn } from "../cn";

describe("cn", () => {
  it("joins truthy class strings and drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b c")).toBe("a b c");
  });
});
