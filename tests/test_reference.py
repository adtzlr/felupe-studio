"""The command reference of the documentation is generated from the schema (#33)."""

import sys
from pathlib import Path

DOCS = Path(__file__).parents[1] / "docs"
sys.path.insert(0, str(DOCS))

from make_reference import markdown  # noqa: E402

from felupe_studio.commands import KINDS  # noqa: E402


def test_reference_is_up_to_date():
    assert (DOCS / "reference.md").read_text(encoding="utf-8") == markdown(), (
        "Run python docs/make_reference.py and commit the result."
    )


def test_reference_documents_every_command():
    text = markdown()
    for command in KINDS:
        assert f"### `{command}`" in text
        assert f"(#{command.replace('.', '')})" in text


def test_reference_types_and_kinds():
    text = markdown()
    target = "| `ramp.items[].target` | name of a boundary, load case or point load |"
    assert target in text
    assert "| `steps` | names of steps (at least 1, unique) | yes |" in text
    assert (
        "| `nu` (ν) | number ≥ -1, < 0.5 | yes | Poisson's ratio. Default `0.3`. |"
        in (text)
    )
    assert "#### By coordinates" in text
