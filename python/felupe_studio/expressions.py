"""Expressions of the parameters in the values of commands (#242, ADR 0013).

A number field of a command holds a number or an expression of the parameters as a
string, e.g. ``"end": "0.25 * layers * height"``. The grammar is small and the same
as in the app (``app/src/core/expressions.ts``), with the same results and messages
(``tests/data/expression_cases.json``):

- numbers (also ``1e-3``), the names of the parameters and the constant ``pi``;
- ``+ - * /`` and ``**`` (right-associative, before a unary minus on its left),
  parentheses;
- the functions ``sqrt exp log sin cos tan abs`` and ``min max`` (two or more
  arguments), angles in radians.

Both parse an expression by the same recursive descent, without ``eval``. The values
are floats (IEEE doubles, like JavaScript); a value that is not finite is an error.

The fields that may hold an expression are those of the schema with the types
``["number", "string"]`` (or ``["integer", "string"]``). :func:`resolve` replaces
the expressions of a command list by their values, which know their expression: the
generated script shows the expression as written (``repr``).
"""

import json
import math
import operator
import re
from decimal import Decimal

# the functions: (the smallest and the largest number of arguments, the function)
FUNCTIONS = {
    "sqrt": (1, 1, math.sqrt),
    "exp": (1, 1, math.exp),
    "log": (1, 1, math.log),
    "sin": (1, 1, math.sin),
    "cos": (1, 1, math.cos),
    "tan": (1, 1, math.tan),
    "abs": (1, 1, abs),
    "min": (2, None, min),
    "max": (2, None, max),
}

# the functions of the generated script: NumPy, or the builtins of Python
NUMPY = ("sqrt", "exp", "log", "sin", "cos", "tan")

CONSTANTS = {"pi": math.pi}

# ASCII digits and names only, like the app
TOKEN = re.compile(
    r"\s*(?:(?P<number>(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)"
    r"|(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op>\*\*|[-+*/(),]))"
)


class ExpressionError(ValueError):
    """An expression is not valid, or its value is not a finite number."""


def number_text(value):
    """A number as text like ``String(value)`` of JavaScript, e.g. ``3``, ``0.5`` or
    ``1e-7``, for the same messages as the app.

    Examples
    --------
    >>> [number_text(v) for v in (3.0, -0.5, 1e-5, 1e-7, 2.5e21)]
    ['3', '-0.5', '0.00001', '1e-7', '2.5e+21']
    """
    value = float(value)
    if value == 0:
        return "0"
    if not math.isfinite(value):
        return (
            "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")
        )
    sign, digits, exponent = Decimal(repr(value)).normalize().as_tuple()
    text = "".join(map(str, digits))
    k, n = len(digits), exponent + len(digits)
    if k <= n <= 21:
        text = text + "0" * (n - k)
    elif 0 < n <= 21:
        text = text[:n] + "." + text[n:]
    elif -6 < n <= 0:
        text = "0." + "0" * -n + text
    else:
        e = n - 1
        mantissa = text[0] + ("." + text[1:] if k > 1 else "")
        text = f"{mantissa}e{'+' if e > 0 else '-'}{abs(e)}"
    return ("-" if sign else "") + text


def tokens(text):
    """Return the tokens of an expression as ``(kind, text)`` pairs."""
    result, position, source = [], 0, text.strip()
    while position < len(source):
        match = TOKEN.match(source, position)
        if not match or match.end() == position:
            raise ExpressionError(f"'{text}' is not a valid expression.")
        kind = match.lastgroup
        result.append((kind, match.group(kind)))
        position = match.end()
    return result


class _Parser:
    """A recursive descent parser of the tokens of an expression, a method per rule
    of the grammar."""

    def __init__(self, text):
        self.items = tokens(text)
        self.position = 0
        self.invalid = ExpressionError(f"'{text}' is not a valid expression.")

    def peek(self):
        if self.position < len(self.items):
            return self.items[self.position]
        return (None, None)

    def take(self, expected=None):
        kind, value = self.peek()
        if kind is None or (expected is not None and value != expected):
            raise self.invalid
        self.position += 1
        return kind, value

    def tree(self):
        if not self.items:
            raise self.invalid
        tree = self.expression()
        if self.position != len(self.items):
            raise self.invalid
        return tree

    def expression(self):
        node = self.term()
        while self.peek()[1] in ("+", "-"):
            node = (self.take()[1], node, self.term())
        return node

    def term(self):
        node = self.unary()
        while self.peek()[1] in ("*", "/"):
            node = (self.take()[1], node, self.unary())
        return node

    def unary(self):
        if self.peek()[1] in ("+", "-"):
            sign = self.take()[1]
            return ("neg" if sign == "-" else "pos", self.unary())
        return self.power()

    def power(self):
        node = self.atom()
        if self.peek()[1] == "**":
            self.take()
            return ("**", node, self.unary())
        return node

    def atom(self):
        kind, value = self.take()
        if kind == "number":
            return ("number", float(value))
        if kind == "name":
            return self.call(value) if self.peek()[1] == "(" else ("name", value)
        if value == "(":
            node = self.expression()
            self.take(")")
            return node
        raise self.invalid

    def call(self, name):
        self.take("(")
        arguments = [self.expression()]
        while self.peek()[1] == ",":
            self.take(",")
            arguments.append(self.expression())
        self.take(")")
        return ("call", name, arguments)


def parse(text):
    """Return the tree of an expression (nested tuples), or raise an
    :class:`ExpressionError`:

    - ``("number", value)``, ``("name", name)``;
    - ``("neg", a)``, ``("pos", a)``, ``(op, a, b)`` for ``+ - * / **``;
    - ``("call", name, [arguments])``.

    Examples
    --------
    >>> parse("-2 ** 2")
    ('neg', ('**', ('number', 2.0), ('number', 2.0)))
    """
    return _Parser(text).tree()


def names(text):
    """Return the names that an expression uses, in their order: parameters or
    ``pi``, not the functions.

    Examples
    --------
    >>> names("max(h, 2 * pi * r) + h")
    ['h', 'pi', 'r']
    """
    result = []

    def walk(node):
        if node[0] == "name":
            if node[1] not in result:
                result.append(node[1])
        elif node[0] == "call":
            for argument in node[2]:
                walk(argument)
        elif node[0] in ("neg", "pos"):
            walk(node[1])
        elif node[0] != "number":
            walk(node[1])
            walk(node[2])

    walk(parse(text))
    return result


# the binary operators of the tree of an expression
OPERATORS = {
    "+": operator.add,
    "-": operator.sub,
    "*": operator.mul,
    "/": operator.truediv,
    "**": math.pow,
}


class _Evaluator:
    """The value of the tree of an expression with the values of the parameters."""

    def __init__(self, text, values):
        self.text = text
        self.values = values

    def value(self, node):
        kind = node[0]
        if kind == "number":
            return node[1]
        if kind == "name":
            return self.name(node[1])
        if kind == "call":
            return self.call(node[1], node[2])
        if kind == "neg":
            return -self.value(node[1])
        if kind == "pos":
            return self.value(node[1])
        return OPERATORS[kind](self.value(node[1]), self.value(node[2]))

    def name(self, name):
        if name in self.values:
            return float(self.values[name])
        if name in CONSTANTS:
            return CONSTANTS[name]
        raise ExpressionError(f"'{name}' is not a parameter in '{self.text}'.")

    def call(self, name, arguments):
        if name not in FUNCTIONS:
            raise ExpressionError(f"'{name}' is not a function in '{self.text}'.")
        low, high, function = FUNCTIONS[name]
        if len(arguments) < low or (high is not None and len(arguments) > high):
            count = f"{low} argument" if high == 1 else f"at least {low} arguments"
            raise ExpressionError(f"'{name}' takes {count} in '{self.text}'.")
        return float(function(*(self.value(a) for a in arguments)))


def evaluate(text, values):
    """Return the value of an expression with the values of the parameters, or raise
    an :class:`ExpressionError`.

    Examples
    --------
    >>> evaluate("0.25 * layers * height", {"layers": 3, "height": 10.0})
    7.5
    >>> evaluate("2 ** 3 ** 2", {})
    512.0
    """
    tree = parse(text)
    nonfinite = ExpressionError(f"'{text}' is not a finite number.")
    try:
        result = _Evaluator(text, values).value(tree)
    except (ZeroDivisionError, ValueError, OverflowError) as error:
        if isinstance(error, ExpressionError):
            raise
        raise nonfinite from None
    if not math.isfinite(result):
        raise nonfinite
    return result


def rename(text, old, new):
    """Return an expression with a parameter renamed (whole names only).

    Examples
    --------
    >>> rename("2 * h + h2", "h", "height")
    '2 * height + h2'
    """
    pattern = rf"(?<![\w.]){re.escape(old)}(?![\w])"
    return re.sub(pattern, lambda _: new, text, flags=re.ASCII)


def python_code(text, parameters=()):
    """Return the code of an expression in the generated script: the functions of
    NumPy (``np.sqrt``) and ``np.pi`` (unless ``pi`` is a parameter), in parentheses
    unless it is a name or a number.

    Examples
    --------
    >>> python_code("sqrt(2) * pi * r")
    '(np.sqrt(2) * np.pi * r)'
    >>> python_code("height")
    'height'
    """
    text = text.strip()
    code = re.sub(rf"(?<![\w.])({'|'.join(NUMPY)})(?=\s*\()", r"np.\1", text)
    if "pi" not in parameters:
        code = re.sub(r"(?<![\w.])pi(?![\w(])", "np.pi", code)
    if len(tokens(text)) == 1:
        return code
    return f"({code})"


class Value(float):
    """The value of an expression, which is shown as its code in the script
    (``repr``). Arithmetic gives plain floats."""

    def __new__(cls, value, code):
        self = super().__new__(cls, value)
        self.code = code
        return self

    def __repr__(self):
        return self.code

    __str__ = __repr__


class IntegerValue(int):
    """The integer value of an expression, e.g. of the substeps of a ramp."""

    def __new__(cls, value, code):
        self = super().__new__(cls, value)
        self.code = code
        return self

    def __repr__(self):
        return self.code

    __str__ = __repr__


# the schema of the commands: the fields that may hold an expression (#242)


def _schema():
    from .commands import schema

    return schema()


def _definition(node):
    """A node of the schema with its reference resolved."""
    while "$ref" in node:
        node = _schema()["$defs"][node["$ref"].split("/")[-1]]
    return node


def _matches(branch, instance):
    """Whether a branch of a ``oneOf`` may describe an instance: its constants and
    its required properties (e.g. the model of a material, the keys of a
    selection)."""
    branch = _definition(branch)
    if not isinstance(instance, dict):
        return True
    for key, node in branch.get("properties", {}).items():
        if "const" in node and instance.get(key) != node["const"]:
            return False
    return all(key in instance for key in branch.get("required", []))


CONSTRAINTS = ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum")


class _Fields:
    """The fields of a command that hold an expression, found by walking the schema
    along the command."""

    def __init__(self):
        self.result, self.seen = [], set()

    def walk(self, node, instance, path):
        node = _definition(node)
        self.branches(node, instance, path)
        if self.leaf(node, instance, path):
            return
        if isinstance(instance, dict):
            for key, child in node.get("properties", {}).items():
                if key in instance:
                    self.walk(child, instance[key], [*path, key])
        elif isinstance(instance, list) and isinstance(node.get("items"), dict):
            for i, item in enumerate(instance):
                self.walk(node["items"], item, [*path, i])

    def branches(self, node, instance, path):
        """The branches of a node that may describe the instance."""
        for key in ("oneOf", "anyOf"):
            for branch in node.get(key, []):
                if _matches(branch, instance):
                    self.walk(branch, instance, path)
        for branch in node.get("allOf", []):
            self.walk(branch, instance, path)
        for key in ("then", "else"):
            if key in node:
                self.walk(node[key], instance, path)

    def leaf(self, node, instance, path):
        """A string where the schema takes a number or a string: an expression."""
        types = node.get("type")
        if not isinstance(instance, str) or not isinstance(types, list):
            return False
        if "string" not in types:
            return False
        if ("number" in types or "integer" in types) and tuple(path) not in self.seen:
            self.seen.add(tuple(path))
            bounds = {k: node[k] for k in CONSTRAINTS if k in node}
            self.result.append((path, "integer" in types, bounds))
        return True


def fields(command):
    """Return the fields of a command that hold an expression, as ``(path, integer,
    constraints)``: the path of keys and indices, whether its value is an integer,
    and the bounds of its value (``minimum``, ``exclusiveMinimum``, ...), in the
    order of the schema."""
    walker = _Fields()
    command_schema = {"oneOf": _schema()["$defs"]["Command"]["oneOf"]}
    walker.walk(command_schema, command, [])
    return walker.result


def _bound_problem(value, bounds):
    """The bound of the schema that a value breaks, as a phrase, or None."""
    rules = {
        "minimum": (lambda v, b: v >= b, "at least"),
        "maximum": (lambda v, b: v <= b, "at most"),
        "exclusiveMinimum": (lambda v, b: v > b, "greater than"),
        "exclusiveMaximum": (lambda v, b: v < b, "less than"),
    }
    for key in CONSTRAINTS:
        if key in bounds and not rules[key][0](value, bounds[key]):
            return f"{rules[key][1]} {number_text(bounds[key])}"
    return None


def parameter_values(commands):
    """Return the values of the parameters of a command list, integer parameters as
    integers, like the generated script."""
    return {
        c["name"]: int(c["value"]) if c.get("integer") else float(c["value"])
        for c in commands
        if c["command"] == "parameter.add"
    }


def resolve(document):
    """Return a copy of a command list with the values of its expressions (#242),
    and the problems of the expressions as messages like the validation of the
    app. The values know their expression (:class:`Value`), so the script shows it.

    Examples
    --------
    >>> document = {"schema_version": 3, "commands": [
    ...     {"command": "parameter.add", "name": "h", "value": 4},
    ...     {"command": "symmetry.add", "name": "s", "axes": ["z"], "z": "h / 2"},
    ... ]}
    >>> resolved, problems = resolve(document)
    >>> resolved["commands"][1]["z"], float(resolved["commands"][1]["z"])
    ((h / 2), 2.0)
    """
    copy = json.loads(json.dumps(document))
    values = parameter_values(copy["commands"])
    problems = []
    for i, command in enumerate(copy["commands"]):
        for path, integer, bounds in fields(command):
            *owner_path, key = path
            owner = command
            for step in owner_path:
                owner = owner[step]
            text = owner[key]
            where = ".".join(str(p) for p in path)
            prefix = f"commands/{i}: '{where}' of '{command.get('name')}': "
            try:
                value = evaluate(text, values)
            except ExpressionError as error:
                problems.append(prefix + str(error))
                continue
            if integer and not value.is_integer():
                problems.append(
                    prefix + f"'{text}' is {number_text(value)}, not an integer."
                )
                continue
            problem = _bound_problem(value, bounds)
            if problem:
                problems.append(
                    prefix + f"'{text}' is {number_text(value)}, it must be {problem}."
                )
                continue
            code = python_code(text, values)
            owner[key] = (
                IntegerValue(int(value), code) if integer else Value(value, code)
            )
    return copy, problems


def rename_parameter(command, old, new):
    """Return a copy of a command whose expressions use a renamed parameter."""
    copy = json.loads(json.dumps(command))
    for path, _, _ in fields(copy):
        *owner_path, key = path
        owner = copy
        for step in owner_path:
            owner = owner[step]
        owner[key] = rename(owner[key], old, new)
    return copy
