"""Expressions of parameters in the values of commands (#242, ADR 0013)."""

import copy
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

from felupe_studio.codegen import codegen
from felupe_studio.commands import errors, rename_references
from felupe_studio.expressions import (
    ExpressionError,
    IntegerValue,
    Value,
    evaluate,
    fields,
    names,
    number_text,
    python_code,
    resolve,
)

DATA = Path(__file__).parent / "data"
sys.path.insert(0, str(DATA))

from make_expression_cases import CASES, case, field_cases  # noqa: E402

STORED = json.loads((DATA / "expression_cases.json").read_text(encoding="utf-8"))


def test_expression_cases_are_up_to_date():
    assert STORED == {
        "expressions": [case(text, values) for text, values in CASES],
        "fields": field_cases(),
    }, "Run python tests/data/make_expression_cases.py and commit the result."


@pytest.mark.parametrize("stored", STORED["expressions"], ids=lambda c: c["text"])
def test_expression_cases(stored):
    if "error" in stored:
        with pytest.raises(ExpressionError, match="^" + _escape(stored["error"])):
            evaluate(stored["text"], stored["values"])
    else:
        assert evaluate(stored["text"], stored["values"]) == stored["value"]


def _escape(text):
    import re

    return re.escape(text) + "$"


def test_cases_cover_the_grammar():
    errors_ = [c["error"] for c in STORED["expressions"] if "error" in c]
    for message in (
        "is not a valid expression.",
        "is not a parameter in",
        "is not a function in",
        "takes 1 argument in",
        "takes at least 2 arguments in",
        "is not a finite number.",
    ):
        assert any(message in e for e in errors_), message
    # the fields of every kind of command of the golden cases and the samples
    kinds = {c["command"]["command"] for c in STORED["fields"] if c["fields"]}
    assert len(kinds) >= 10


def test_names():
    # like names() of the app
    assert names("max(h, 2 * pi * r) + h") == ["h", "pi", "r"]
    assert names("-(a ** b) / sqrt(c)") == ["a", "b", "c"]


def test_number_text_like_javascript():
    values = (3.0, -0.5, 1e-5, 1e-7, 2.5e21, 1e21, 123456.789, 0.1 + 0.2, -0.0)
    expected = [
        "3",
        "-0.5",
        "0.00001",
        "1e-7",
        "2.5e+21",
        "1e+21",
        "123456.789",
        "0.30000000000000004",
        "0",
    ]
    assert [number_text(v) for v in values] == expected


def test_fields_of_the_schema():
    # number fields that are text; others stay (the value of a parameter, the tag of
    # a cell set, the ids of a point set and the decimals of the merge)
    command = {
        "command": "rigid.add",
        "name": "die",
        "coordinates": ["0", "0", "h"],
        "shape": {"radius": "r", "axis": [0, "1", 0]},
    }
    assert [path for path, _, _ in fields(command)] == [
        ["coordinates", 0],
        ["coordinates", 1],
        ["coordinates", 2],
        ["shape", "radius"],
        ["shape", "axis", 1],
    ]
    ramp = {
        "command": "step.add",
        "name": "s",
        "ramp": {"num": "n", "items": [{"target": "t", "end": ["a", "b"]}]},
    }
    assert fields(ramp) == [
        (["ramp", "num"], True, {"minimum": 1}),
        (["ramp", "items", 0, "end", 0], False, {}),
        (["ramp", "items", 0, "end", 1], False, {}),
    ]
    for command in (
        {"command": "parameter.add", "name": "p", "value": "1"},
        {"command": "cellset.from_tag", "name": "c", "mesh": "m", "value": "1"},
        {"command": "pointset.add", "name": "p", "select": {"ids": ["1"]}},
        {"command": "mesh.merge", "name": "merge", "decimals": "6"},
    ):
        assert fields(command) == []


def document(**changes):
    commands = [
        {"command": "parameter.add", "name": "h", "value": 4},
        {"command": "parameter.add", "name": "n", "value": 3.0, "integer": True},
        {"command": "symmetry.add", "name": "s", "axes": ["z"], "z": "h / 2"},
        {"command": "loadcase.add", "name": "t", "type": "uniaxial"},
        {
            "command": "step.add",
            "name": "step",
            "ramp": {"num": "2 * n", "items": [{"target": "t", "end": "sqrt(h)"}]},
        },
    ]
    for name, fields_ in changes.items():
        next(c for c in commands if c["name"] == name).update(fields_)
    return {"schema_version": 3, "commands": commands}


def test_resolve():
    resolved, problems = resolve(document())
    assert problems == []
    z = resolved["commands"][2]["z"]
    assert isinstance(z, Value) and z == 2.0 and repr(z) == "(h / 2)"
    num = resolved["commands"][4]["ramp"]["num"]
    assert isinstance(num, IntegerValue) and num == 6 and repr(num) == "(2 * n)"
    end = resolved["commands"][4]["ramp"]["items"][0]["end"]
    assert end == 2.0 and repr(end) == "(np.sqrt(h))"
    # arithmetic gives plain numbers
    assert type(z * 2) is float and repr(z * 2) == "4.0"
    # the document is not changed
    assert document()["commands"][2]["z"] == "h / 2"


def test_resolve_problems():
    _, problems = resolve(
        document(s={"z": "h / (n - 3)"}, step={"ramp": {"num": "n / 2", "items": []}})
    )
    assert problems == [
        "commands/2: 'z' of 's': 'h / (n - 3)' is not a finite number.",
        "commands/4: 'ramp.num' of 'step': 'n / 2' is 1.5, not an integer.",
    ]


def test_python_code():
    assert python_code("sqrt(2) * pi * r") == "(np.sqrt(2) * np.pi * r)"
    assert python_code(" r ") == "r"
    assert python_code("2.5") == "2.5"
    assert python_code("max(r, 1)") == "(max(r, 1))"
    assert python_code("abs(-r) + exp(1)") == "(abs(-r) + np.exp(1))"
    # pi as a parameter of the model
    assert python_code("2 * pi", {"pi": 3}) == "(2 * pi)"


def test_codegen_shows_the_expressions(tmp_path, monkeypatch):
    from test_codegen import bar, force, run, write

    two_sections = json.loads((DATA / "two_sections.json").read_text("utf-8"))
    numbers = copy.deepcopy(two_sections)
    two_sections["commands"][:0] = [
        {"command": "parameter.add", "name": "length", "value": 3},
        {"command": "parameter.add", "name": "stroke", "value": 0.5},
        {"command": "parameter.add", "name": "cells", "value": 5, "integer": True},
    ]
    commands = {c["name"]: c for c in two_sections["commands"]}
    commands["right"]["select"]["value"] = "length"
    commands["step_1"]["ramp"]["num"] = "cells"
    commands["step_1"]["ramp"]["items"][0]["end"] = "stroke"
    commands["umat_soft"]["parameters"]["mu"] = "cos(0) * min(1, length)"
    assert errors(two_sections) == []
    script = codegen(two_sections)
    assert "np.isclose(points[:, 0], length, atol=1e-08)" in script
    assert "fem.math.linsteps([0, stroke], num=cells)" in script
    assert "fem.NeoHooke(mu=(np.cos(0) * min(1, length)))" in script
    assert "np.isclose(points[:, 0], 3, atol=1e-08)" in codegen(numbers)

    # the same results as the numbers
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    expressions = force(run(two_sections, tmp_path, monkeypatch))
    np.testing.assert_allclose(
        expressions, force(run(numbers, tmp_path, monkeypatch)), rtol=1e-12
    )


def test_rename_a_parameter():
    step = document()["commands"][4]
    renamed = rename_references(step, "n", "count")
    assert renamed["ramp"]["num"] == "2 * count"
    assert step["ramp"]["num"] == "2 * n"


def test_errors_with_expressions_first():
    # the rules of the references run with the values of the expressions
    assert errors(document()) == []
    problems = errors(document(s={"z": "2 * x"}))
    assert problems == ["commands/2: 'z' of 's': 'x' is not a parameter in '2 * x'."]


def test_nonfinite_inside_like_the_app():
    # Python raises on a division by zero inside an expression, the app too
    with pytest.raises(ExpressionError):
        evaluate("1 / (1 / 0)", {})
    assert math.isclose(evaluate("1 / (1e308 * 10)", {}), 0.0)
