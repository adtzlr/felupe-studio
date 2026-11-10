"""Write validation_cases.json: command lists and their expected error messages.

The cases are shared by the Python validation (felupe_studio.commands) and the
TypeScript validation (app/src/core/validate.ts), so both report the same messages.
Run ``python tests/data/make_validation_cases.py`` after changing a message.
"""

import copy
import json
from pathlib import Path

from felupe_studio.commands import errors

HERE = Path(__file__).parent


def find(document, name):
    return next(c for c in document["commands"] if c["name"] == name)


def remove(document, name):
    document["commands"].remove(find(document, name))


CHANGES = {
    "valid": lambda d: None,
    "unknown mesh": lambda d: find(d, "hard").update(mesh="nomesh"),
    "wrong kind": lambda d: find(d, "section_hard").update(cellset="umat_hard"),
    "unknown point set": lambda d: find(d, "fixed").update(pointset="right2"),
    "step with a cell set": lambda d: find(d, "step_1").update(sections=["hard"]),
    "ramp of a point set": lambda d: find(d, "step_1")["ramp"].update(boundary="left"),
    "unknown curve": lambda d: find(d, "job_1").update(curve="fixed2"),
    "duplicate name": lambda d: find(d, "soft").update(name="hard"),
    "mesh without tag": lambda d: find(d, "specimen").pop("tag"),
    "mesh with cell type": lambda d: find(d, "specimen").update(cell_type="tetra10"),
    "NeoHooke without bulk": lambda d: (
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    "NeoHooke with bulk": lambda d: (
        find(d, "umat_soft")["parameters"].update(bulk=5000),
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    "keyword": lambda d: find(d, "job_1").update(name="lambda"),
    "reserved name": lambda d: find(d, "job_1").update(name="field"),
    "reserved prefix": lambda d: find(d, "job_1").update(name="solid_a"),
    "used before defined": lambda d: d["commands"].insert(
        0, d["commands"].pop(d["commands"].index(find(d, "job_1")))
    ),
    "removed material": lambda d: remove(d, "umat_hard"),
    "two merges": lambda d: d["commands"].__setitem__(
        slice(1, 1),
        [
            {"command": "mesh.merge", "name": "merge", "decimals": 6},
            {"command": "mesh.merge", "name": "merge_2", "decimals": 8},
        ],
    ),
    "several errors": lambda d: (
        find(d, "hard").update(mesh="nomesh"),
        find(d, "job_1").update(name="hard"),
    ),
}


def cases():
    base = json.loads((HERE / "two_sections.json").read_text(encoding="utf-8"))
    result = []
    for name, change in CHANGES.items():
        document = copy.deepcopy(base)
        change(document)
        result.append({"name": name, "document": document, "errors": errors(document)})
    return result


if __name__ == "__main__":
    text = json.dumps(cases(), indent=2) + "\n"
    (HERE / "validation_cases.json").write_text(text, encoding="utf-8")
