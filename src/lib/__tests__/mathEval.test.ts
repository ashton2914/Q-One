import { describe, expect, it } from "vitest";
import { evaluateFormulaInput } from "../mathEval";

describe("evaluateFormulaInput", () => {
  it("evaluates basic arithmetic with operator precedence and parentheses", () => {
    expect(evaluateFormulaInput("=44.88/2")).toBe("22.44");
    expect(evaluateFormulaInput("=10 + 20 * 3")).toBe("70");
    expect(evaluateFormulaInput("=(10 + 20) * 3")).toBe("90");
    expect(evaluateFormulaInput("=100 - 12.5 - 2.5")).toBe("85");
    expect(evaluateFormulaInput("=44.88 × 2 ÷ 4")).toBe("22.44");
  });

  it("handles unary signs and eliminates IEEE-754 floating-point noise", () => {
    expect(evaluateFormulaInput("=0.1+0.2")).toBe("0.3");
    expect(evaluateFormulaInput("=44.88-0.1")).toBe("44.78");
    expect(evaluateFormulaInput("=-10+3.5")).toBe("-6.5");
    expect(evaluateFormulaInput("=-(5-2)*2")).toBe("-6");
    expect(evaluateFormulaInput("=0*-5")).toBe("0");
  });

  it("returns null for non-formula text or invalid expressions", () => {
    expect(evaluateFormulaInput("44.88")).toBeNull();
    expect(evaluateFormulaInput("44.88/2")).toBeNull();
    expect(evaluateFormulaInput("=")).toBeNull();
    expect(evaluateFormulaInput("=10/0")).toBeNull();
    expect(evaluateFormulaInput("=(10+2")).toBeNull();
    expect(evaluateFormulaInput("=10+abc")).toBeNull();
    expect(evaluateFormulaInput("=10+*2")).toBeNull();
  });
});
