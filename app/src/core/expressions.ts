// Expressions of the parameters in the values of commands (#242, ADR 0013): a
// number field holds a number or an expression as a string, e.g.
// "0.25 * layers * height". The grammar, the values and the messages are those of
// felupe_studio.expressions (tests/data/expression_cases.json):
// - numbers (also 1e-3), the names of the parameters and the constant pi;
// - + - * / and ** (right-associative, before a unary minus on its left),
//   parentheses;
// - the functions sqrt exp log sin cos tan abs and min max (two or more
//   arguments), angles in radians.
// Both parse an expression by the same recursive descent, without eval.

export class ExpressionError extends Error {}

/** The functions: the smallest and the largest number of arguments (or none). */
const FUNCTIONS: Record<
  string,
  [number, number | undefined, (...x: number[]) => number]
> = {
  sqrt: [1, 1, Math.sqrt],
  exp: [1, 1, Math.exp],
  log: [1, 1, Math.log],
  sin: [1, 1, Math.sin],
  cos: [1, 1, Math.cos],
  tan: [1, 1, Math.tan],
  abs: [1, 1, Math.abs],
  // like min and max of Python: the first of equal values, NaN only if it is first
  min: [2, undefined, (...x) => x.reduce((a, b) => (b < a ? b : a))],
  max: [2, undefined, (...x) => x.reduce((a, b) => (b > a ? b : a))],
};

/** The functions of Python's math module, which raise an error without a value. */
const MATH = new Set(["sqrt", "exp", "log", "sin", "cos", "tan"]);

const CONSTANTS: Record<string, number> = { pi: Math.PI };

/** The names of the functions, e.g. for the hints of a field. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

// ASCII digits and names only, like Python
const TOKEN =
  /\s*(?:(?<number>(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)|(?<name>[A-Za-z_][A-Za-z0-9_]*)|(?<op>\*\*|[-+*/(),]))/y;

type Token = ["number" | "name" | "op", string];

export type Node =
  | ["number", number]
  | ["name", string]
  | ["neg" | "pos", Node]
  | ["+" | "-" | "*" | "/" | "**", Node, Node]
  | ["call", string, Node[]];

const invalid = (text: string) =>
  new ExpressionError(`'${text}' is not a valid expression.`);

/** The tokens of an expression. */
export function tokens(text: string): Token[] {
  const source = text.trim();
  const result: Token[] = [];
  let position = 0;
  while (position < source.length) {
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(source);
    if (!match || TOKEN.lastIndex === position) throw invalid(text);
    const groups = match.groups!;
    const kind = (["number", "name", "op"] as const).find(
      (k) => groups[k] !== undefined,
    )!;
    result.push([kind, groups[kind]]);
    position = TOKEN.lastIndex;
  }
  return result;
}

/** The tree of an expression, or an ExpressionError. */
export function parse(text: string): Node {
  const items = tokens(text);
  let position = 0;
  const peek = (): string | undefined => items[position]?.[1];
  const take = (expected?: string): Token => {
    const token = items[position];
    if (!token || (expected !== undefined && token[1] !== expected))
      throw invalid(text);
    position += 1;
    return token;
  };

  const expression = (): Node => {
    let node = term();
    while (peek() === "+" || peek() === "-")
      node = [take()[1] as "+" | "-", node, term()];
    return node;
  };
  const term = (): Node => {
    let node = unary();
    while (peek() === "*" || peek() === "/")
      node = [take()[1] as "*" | "/", node, unary()];
    return node;
  };
  const unary = (): Node => {
    if (peek() === "+" || peek() === "-") {
      const sign = take()[1];
      return [sign === "-" ? "neg" : "pos", unary()];
    }
    return power();
  };
  const power = (): Node => {
    const node = atom();
    if (peek() === "**") {
      take();
      return ["**", node, unary()];
    }
    return node;
  };
  const atom = (): Node => {
    const [kind, value] = take();
    if (kind === "number") return ["number", Number(value)];
    if (kind === "name") {
      if (peek() === "(") {
        take("(");
        const args = [expression()];
        while (peek() === ",") {
          take(",");
          args.push(expression());
        }
        take(")");
        return ["call", value, args];
      }
      return ["name", value];
    }
    if (value === "(") {
      const node = expression();
      take(")");
      return node;
    }
    throw invalid(text);
  };

  if (!items.length) throw invalid(text);
  const tree = expression();
  if (position !== items.length) throw invalid(text);
  return tree;
}

/** The names that an expression uses, in their order: parameters or pi, not functions. */
export function names(text: string): string[] {
  const result: string[] = [];
  const walk = (node: Node): void => {
    if (node[0] === "name") {
      if (!result.includes(node[1])) result.push(node[1]);
    } else if (node[0] === "call") node[2].forEach(walk);
    else if (node[0] === "neg" || node[0] === "pos") walk(node[1]);
    else if (node[0] !== "number") {
      const [, a, b] = node as ["+", Node, Node];
      walk(a);
      walk(b);
    }
  };
  walk(parse(text));
  return result;
}

/** The value of an expression with the values of the parameters. */
export function evaluate(
  text: string,
  values: Readonly<Record<string, number>>,
): number {
  const tree = parse(text);
  const nonfinite = () =>
    new ExpressionError(`'${text}' is not a finite number.`);
  // like Python: a division by zero is an error, and so is a function of the math
  // module or a power without a value (NaN of numbers, an overflow of finite
  // numbers), also inside, e.g. 1 / (1 / 0)
  const checked = (result: number, inputs: number[]) => {
    if (
      Number.isNaN(result)
        ? !inputs.some(Number.isNaN)
        : !Number.isFinite(result) && inputs.every(Number.isFinite)
    )
      throw nonfinite();
    return result;
  };
  const value = (node: Node): number => {
    switch (node[0]) {
      case "number":
        return node[1];
      case "name": {
        const name = node[1];
        if (Object.hasOwn(values, name)) return values[name];
        if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
        throw new ExpressionError(`'${name}' is not a parameter in '${text}'.`);
      }
      case "call": {
        const [, name, args] = node;
        if (!Object.hasOwn(FUNCTIONS, name))
          throw new ExpressionError(
            `'${name}' is not a function in '${text}'.`,
          );
        const [low, high, fn] = FUNCTIONS[name];
        if (args.length < low || (high !== undefined && args.length > high)) {
          const count =
            high === 1 ? `${low} argument` : `at least ${low} arguments`;
          throw new ExpressionError(`'${name}' takes ${count} in '${text}'.`);
        }
        const inputs = args.map(value);
        return MATH.has(name) ? checked(fn(...inputs), inputs) : fn(...inputs);
      }
      case "neg":
        return -value(node[1]);
      case "pos":
        return value(node[1]);
      case "+":
        return value(node[1]) + value(node[2]);
      case "-":
        return value(node[1]) - value(node[2]);
      case "*":
        return value(node[1]) * value(node[2]);
      case "/": {
        const [a, b] = [value(node[1]), value(node[2])];
        if (b === 0) throw nonfinite();
        return a / b;
      }
      case "**": {
        const [a, b] = [value(node[1]), value(node[2])];
        return checked(Math.pow(a, b), [a, b]);
      }
    }
  };
  const result = value(tree);
  if (!Number.isFinite(result)) throw nonfinite();
  return result;
}

/** An expression with a parameter renamed (whole names only). */
export function rename(text: string, old: string, name: string): string {
  const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w.])${escaped}(?!\\w)`, "g");
  return text.replace(pattern, () => name);
}
