"""Python source of the script, formatted like ruff format would format it (ADR 0018).

The parts of the script build their lines from these: string literals, lists of
numbers, and calls and assignments that are wrapped at the line length of 88, with
lists, dicts and calls as arguments that are exploded to one item per line if they
are too long.
"""

import json

LINE_LENGTH = 88


def quote(value):
    """Return a Python string literal with double quotes.

    Examples
    --------
    >>> print(quote("top"))
    "top"
    """
    return json.dumps(value, ensure_ascii=False)


def vector(values):
    """Return a list of numbers, e.g. of coordinates.

    Examples
    --------
    >>> vector([0, 1.5])
    '[0, 1.5]'
    """
    return f"[{', '.join(map(repr, values))}]"


def number(value):
    """Return a number as text, e.g. 0 or 12.5.

    Examples
    --------
    >>> number(0.0), number(12.5)
    ('0', '12.5')
    """
    value = float(value)
    return str(int(value)) if value.is_integer() else repr(value)


def offset(expression, value):
    """Return an expression minus a value, e.g. ``points[:, 1] - 2.0`` (without a
    zero).

    Examples
    --------
    >>> offset("x", 0), offset("x", 2.0), offset("x", -1.5)
    ('x', 'x - 2.0', 'x + 1.5')
    """
    if value == 0:
        return expression
    sign = "-" if value > 0 else "+"
    return f"{expression} {sign} {abs(value)!r}"


class List:
    """A list argument ``prefix[item, ...]`` that ruff format may explode."""

    def __init__(self, items, prefix=""):
        self.items = list(items)
        self.prefix = prefix

    def __str__(self):
        return f"{self.prefix}[{', '.join(self.items)}]"

    def exploded(self, level):
        pad = "    " * level
        items = "".join(f"{pad}    {item},\n" for item in self.items)
        return f"{self.prefix}[\n{items}{pad}]"


class Dict:
    """A dict argument ``prefix{key: value, ...}`` that ruff format may explode."""

    def __init__(self, items, prefix=""):
        self.items = list(items)
        self.prefix = prefix

    def __str__(self):
        return f"{self.prefix}{{{', '.join(map(str, self.items))}}}"

    def exploded(self, level):
        pad = "    " * level
        return f"{self.prefix}{{\n{explode(self.items, level + 1)}{pad}}}"


class Call:
    """A call argument ``func(arg, ...)`` that ruff format may explode."""

    def __init__(self, func, args):
        self.func = func
        self.args = list(args)

    def __str__(self):
        return f"{self.func}({', '.join(map(str, self.args))})"

    def exploded(self, level):
        pad = "    " * level
        inner = f"{pad}    {', '.join(map(str, self.args))}"
        if len(inner) <= LINE_LENGTH:
            return f"{self.func}(\n{inner}\n{pad})"
        return f"{self.func}(\n{explode(self.args, level + 1)}{pad})"


def assign(target, expression):
    """Return an assignment of an expression, wrapped like ruff format would wrap it.

    Examples
    --------
    >>> assign("ramp", Call("fem.math.linsteps", ["[0, 1]", "num=5"]))
    'ramp = fem.math.linsteps([0, 1], num=5)'
    """
    line = f"{target} = {expression}"
    if len(line) <= LINE_LENGTH or not isinstance(expression, Call):
        return line
    return f"{target} = {expression.exploded(0)}"


def explode(args, level=1):
    """Return one argument per line with a trailing comma, like ruff format."""
    pad = "    " * level
    lines = []
    for arg in args:
        line = f"{pad}{arg},"
        if len(line) > LINE_LENGTH and isinstance(arg, (List, Dict, Call)):
            line = f"{pad}{arg.exploded(level)},"
        lines.append(line + "\n")
    return "".join(lines)


def wrap(head, args, level=0, end=""):
    """Return a call ``head(args)``, wrapped like ruff format would wrap it.

    Examples
    --------
    >>> wrap("fem.SolidBody", ["rubber", "field_rubber"])
    'fem.SolidBody(rubber, field_rubber)'
    """
    pad = "    " * level
    line = f"{pad}{head}({', '.join(map(str, args))}){end}"
    if len(line) <= LINE_LENGTH:
        return line
    inner = f"{pad}    " + ", ".join(map(str, args))
    if len(inner) <= LINE_LENGTH:
        return f"{pad}{head}(\n{inner}\n{pad}){end}"
    if len(args) == 1 and isinstance(args[0], List):
        return f"{pad}{head}(\n{pad}    {args[0].exploded(level + 1)}\n{pad}){end}"
    return f"{pad}{head}(\n{explode(args, level + 1)}{pad}){end}"


def call(target, func, args, end=""):
    """Return an assignment of a call, wrapped like ruff format would wrap it.

    Examples
    --------
    >>> call("solid_rubber", "fem.SolidBody", ["rubber", "field_rubber"])
    'solid_rubber = fem.SolidBody(rubber, field_rubber)'
    """
    return wrap(f"{target} = {func}", args, end=end)
