"""The rules of the validation (#310): the same rules in Python and in the app."""

import re
from pathlib import Path

import pytest

from felupe_studio import analysis, rules
from felupe_studio.commands import KINDS

APP = Path(__file__).parents[1] / "app" / "src" / "core"


def camel(name):
    """The name of a rule in TypeScript, e.g. ``rampValues`` of ``ramp_values``."""
    first, *rest = name.split("_")
    return first + "".join(word.title() for word in rest)


def typescript_registry(source, name):
    """The rules of a registry in a TypeScript source: command type -> names."""
    text = (APP / source).read_text(encoding="utf-8")
    block = re.search(rf"export const {name}\b[^=]*= \{{(.*?)\n\}};", text, re.S)
    entries = re.findall(r'"([a-z_.]+)":\s*(\[[^\]]*\]|\w+),', block.group(1))
    return {kind: re.findall(r"\w+", names) for kind, names in entries}


def typescript_list(source, name):
    """The rules of a list in a TypeScript source."""
    text = (APP / source).read_text(encoding="utf-8")
    return re.findall(
        r"\w+", re.search(rf"export const {name}\b.*?= \[(.*?)\];", text, re.S).group(1)
    )


def names(rules_of_a_type):
    rules_of_a_type = (
        rules_of_a_type if isinstance(rules_of_a_type, tuple) else (rules_of_a_type,)
    )
    return [camel(rule.__name__) for rule in rules_of_a_type]


@pytest.mark.parametrize(
    "source, name, registry",
    [
        ("rules.ts", "RULES", rules.RULES),
        ("rules.ts", "AFTER", rules.AFTER),
        ("analysis.ts", "PLANAR", analysis.PLANAR),
    ],
)
def test_the_app_has_the_same_rules(source, name, registry):
    """A rule has the same name in both languages, for the same command types and in
    the same order, so that it is easy to find in both."""
    expected = {
        kind: names(rules_of_a_type) for kind, rules_of_a_type in registry.items()
    }
    assert typescript_registry(source, name) == expected
    assert set(registry) <= set(KINDS)


@pytest.mark.parametrize("name", ["FIRST", "LAST"])
def test_the_app_has_the_same_rules_of_all_commands(name):
    assert typescript_list("rules.ts", name) == names(getattr(rules, name))
