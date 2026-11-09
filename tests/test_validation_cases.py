import json
import sys
from pathlib import Path

DATA = Path(__file__).parent / "data"
sys.path.insert(0, str(DATA))

from make_validation_cases import cases  # noqa: E402


def test_validation_cases_are_up_to_date():
    stored = json.loads((DATA / "validation_cases.json").read_text(encoding="utf-8"))
    assert stored == cases(), (
        "Run python tests/data/make_validation_cases.py and commit the result."
    )


def test_validation_cases_cover_valid_and_invalid():
    stored = json.loads((DATA / "validation_cases.json").read_text(encoding="utf-8"))
    assert any(not c["errors"] for c in stored)
    assert sum(1 for c in stored if c["errors"]) >= 15
