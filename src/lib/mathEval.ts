/**
 * Safe recursive-descent arithmetic evaluator for quick inline formulas
 * prefixed with `=` (e.g. `=44.88/2`, `=(100 - 12.5) * 2`, `=0.1+0.2`).
 * Supports +, -, *, /, unary +/-, parentheses, ×/÷, and decimals.
 */

type Token =
  | { type: "number"; value: number }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-") {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "*" || ch === "×") {
      tokens.push({ type: "op", value: "*" });
      i += 1;
      continue;
    }
    if (ch === "/" || ch === "÷") {
      tokens.push({ type: "op", value: "/" });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let start = i;
      let hasDigit = false;
      let hasDot = false;
      while (i < expr.length) {
        const c = expr[i];
        if (c >= "0" && c <= "9") {
          hasDigit = true;
          i += 1;
        } else if (c === "." && !hasDot) {
          hasDot = true;
          i += 1;
        } else {
          break;
        }
      }
      if (!hasDigit) return null;
      const value = Number(expr.slice(start, i));
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: "number", value });
      continue;
    }
    return null;
  }

  return tokens;
}

function parseTokens(tokens: Token[]): number | null {
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (true) {
      const tok = peek();
      if (tok?.type === "op" && (tok.value === "+" || tok.value === "-")) {
        consume();
        const right = parseTerm();
        if (right === null) return null;
        left = tok.value === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): number | null => {
    let left = parseUnary();
    if (left === null) return null;
    while (true) {
      const tok = peek();
      if (tok?.type === "op" && (tok.value === "*" || tok.value === "/")) {
        consume();
        const right = parseUnary();
        if (right === null) return null;
        if (tok.value === "/") {
          if (right === 0) return null;
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  };

  const parseUnary = (): number | null => {
    const tok = peek();
    if (tok?.type === "op" && (tok.value === "+" || tok.value === "-")) {
      consume();
      const val = parseUnary();
      if (val === null) return null;
      return tok.value === "-" ? -val : val;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number | null => {
    const tok = peek();
    if (!tok) return null;
    if (tok.type === "number") {
      consume();
      return tok.value;
    }
    if (tok.type === "lparen") {
      consume();
      const val = parseExpr();
      if (val === null) return null;
      if (peek()?.type !== "rparen") return null;
      consume();
      return val;
    }
    return null;
  };

  const result = parseExpr();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

export function formatComputedNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Eliminate IEEE-754 trailing noise such as 0.1 + 0.2 = 0.30000000000000004
  const cleaned = Number(value.toPrecision(12));
  const normalized = Object.is(cleaned, -0) ? 0 : cleaned;
  return String(normalized);
}

/**
 * Evaluates a `=`-prefixed formula string and returns the formatted result,
 * or `null` if the input is not a valid formula.
 */
export function evaluateFormulaInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("=")) return null;
  const expr = trimmed.slice(1).trim();
  if (!expr) return null;

  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;

  const result = parseTokens(tokens);
  if (result === null) return null;

  return formatComputedNumber(result);
}
