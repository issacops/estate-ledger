/**
 * Arithmetic expression evaluator for amount fields.
 * Accepts things like `750*3+175+150`. Replaces the unsafe Function() eval
 * used in the prototypes. Returns null when the expression cannot be resolved.
 */
export function evalMath(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? round2(input) : null;
  const s = String(input).trim();
  if (s === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return round2(Number(s));
  if (!/^[\d+\-*/().\s]+$/.test(s)) return null;
  if (!/[+\-*/]/.test(s)) return null;
  const tokens = tokenize(s);
  if (!tokens) return null;
  const val = parseExpr(tokens);
  if (val === null || !Number.isFinite(val)) return null;
  return round2(val);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type Tok = { t: "num"; v: number } | { t: "op"; v: string };

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) return null;
      out.push({ t: "num", v: num });
      i = j;
    } else if ("+-*/()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      return null;
    }
  }
  return out;
}

function parseExpr(tokens: Tok[]): number | null {
  let pos = 0;

  function peek(): string | null {
    return pos < tokens.length && tokens[pos].t === "op"
      ? (tokens[pos] as { t: "op"; v: string }).v
      : null;
  }

  function parseFactor(): number | null {
    const tok = tokens[pos];
    if (!tok) return null;
    if (tok.t === "num") {
      pos++;
      return tok.v;
    }
    if (tok.v === "-") {
      pos++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (tok.v === "+") {
      pos++;
      return parseFactor();
    }
    if (tok.v === "(") {
      pos++;
      const v = parseExprInner();
      if (peek() !== ")") return null;
      pos++;
      return v;
    }
    return null;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    while (left !== null && (peek() === "*" || peek() === "/")) {
      const op = peek();
      pos++;
      const right = parseFactor();
      if (right === null) return null;
      left = op === "*" ? left * right : right === 0 ? NaN : left / right;
    }
    return left;
  }

  function parseExprInner(): number | null {
    let left = parseTerm();
    while (left !== null && (peek() === "+" || peek() === "-")) {
      const op = peek();
      pos++;
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const result = parseExprInner();
  if (pos !== tokens.length) return null;
  return result;
}
