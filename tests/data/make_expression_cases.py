"""Write expression_cases.json: expressions of parameters with their values or their
error messages (#242, ADR 0013).

The cases are shared by felupe_studio.expressions and app/src/core/expressions.ts,
so both have the same grammar, values and messages. The fields that may hold an
expression come from the schema in both (``fields()`` and ``expressionFields()``):
the commands of the golden cases and the samples, with every number as text, and
their fields. Run
``python tests/data/make_expression_cases.py`` after changing the grammar or a
message.
"""

import json
import re
from pathlib import Path

from felupe_studio.expressions import ExpressionError, evaluate, fields

HERE = Path(__file__).parent
ROOT = HERE.parent.parent

VALUES = {"h": 2.5, "n": 3, "layers": 4, "height": 10.0}

CASES = [
    # numbers and operators
    ("1 + 2 * 3", {}),
    ("(1 + 2) * 3", {}),
    ("7 - 2 - 1", {}),
    ("8 / 4 / 2", {}),
    ("1 / 3", {}),
    ("2 ** 3 ** 2", {}),
    ("-2 ** 2", {}),
    ("2 ** -1", {}),
    ("2 * -h", VALUES),
    ("-(-h)", VALUES),
    ("+h", VALUES),
    ("--h", VALUES),
    ("1e-3 * 2", {}),
    ("2.5E+2", {}),
    (".5 + 1.", {}),
    ("  0.25*layers *height ", VALUES),
    ("n / 2", VALUES),
    # functions and constants
    ("pi", {}),
    ("2 * pi * h", VALUES),
    ("sqrt(2) * h", VALUES),
    ("exp(1)", {}),
    ("log(10)", {}),
    ("sin(pi / 6)", {}),
    ("cos(0)", {}),
    ("tan(pi / 4)", {}),
    ("abs(-h)", VALUES),
    ("min(3, h, 1)", VALUES),
    ("max(h, 2)", VALUES),
    ("max(min(h, n), 1) ** 2", VALUES),
    # a parameter goes before a constant and a function of the same name
    ("pi", {"pi": 3}),
    ("sqrt(sqrt)", {"sqrt": 16}),
    # not valid
    ("", {}),
    ("   ", {}),
    ("1 +", {}),
    ("(1 + 2", {}),
    ("1 + 2)", {}),
    ("2 h", VALUES),
    ("h(", VALUES),
    ("min(1,)", {}),
    ("()", {}),
    ("1 ** ", {}),
    ("2 * * 3", {}),
    ("a.b", {}),
    ("1 @ 2", {}),
    ("h ^ 2", VALUES),
    ("1,2", {}),
    ("٣ + 1", {}),
    # unknown names and functions, the number of arguments
    ("2 * x", VALUES),
    ("0.5 * layer * height", VALUES),
    ("sinh(h)", VALUES),
    ("h(2)", VALUES),
    ("min(h)", VALUES),
    ("sqrt(1, 2)", {}),
    # not finite
    ("1 / 0", {}),
    ("h / (n - 3)", VALUES),
    ("1 / (1 / 0)", {}),
    ("log(0)", {}),
    ("sqrt(-1)", {}),
    ("exp(1000)", {}),
    ("10 ** 400", {}),
    ("0 ** -1", {}),
    ("(-8) ** (1 / 3)", {}),
    ("1e400", {}),
    ("1e400 * 0", {}),
]


def case(text, values):
    try:
        return {"text": text, "values": values, "value": evaluate(text, values)}
    except ExpressionError as error:
        return {"text": text, "values": values, "error": str(error)}


def as_text(value):
    """A value with every number as text, e.g. ``{"end": "0.5"}``."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return [as_text(v) for v in value]
    if isinstance(value, dict):
        return {k: v if k == "command" else as_text(v) for k, v in value.items()}
    return value


def field_cases():
    """The commands of the golden cases and the samples with every number as text,
    one of each, and their fields that may hold an expression."""
    files = sorted((ROOT / "tests" / "golden").glob("*/commands.json"))
    # the samples by their ids, without the prefixes of their folders (#350)
    samples = (ROOT / "app" / "samples").glob("*/*.felupe.json")
    files += sorted(samples, key=lambda p: re.sub(r"^\d+_", "", p.parent.name))
    result, seen = [], set()
    for file in files:
        for command in json.loads(file.read_text(encoding="utf-8"))["commands"]:
            command = as_text(command)
            key = json.dumps(command, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            result.append(
                {
                    "command": command,
                    "fields": [
                        {"path": path, "integer": integer, "bounds": bounds}
                        for path, integer, bounds in fields(command)
                    ],
                }
            )
    return result


if __name__ == "__main__":
    cases = {
        "expressions": [case(text, values) for text, values in CASES],
        "fields": field_cases(),
    }
    text = json.dumps(cases, indent=2, ensure_ascii=False) + "\n"
    (HERE / "expression_cases.json").write_text(text, encoding="utf-8")
