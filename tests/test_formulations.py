"""The formulation registry of the sections (ADR 0024, #419)."""

import re
from pathlib import Path

import pytest

from felupe_studio import sections
from felupe_studio._helpers import REGIONS
from felupe_studio.commands import schema, schema_errors
from felupe_studio.formulations import MATERIALS, first, formulation_of, formulations

ROOT = Path(__file__).parents[1]

# a material of every kind, and the formulations that take it
KINDS = {
    "incompressible": (
        {"model": "NeoHooke", "parameters": {"mu": 1}},
        ["u-p-J", "u-isochoric"],
    ),
    "with a bulk modulus": (
        {"model": "NeoHooke", "parameters": {"mu": 1, "bulk": 5000}},
        ["u"],
    ),
    "compressible": (
        {"model": "NeoHookeCompressible", "parameters": {"mu": 1, "lmbda": 5000}},
        ["u"],
    ),
    "strain-based": (
        {"model": "LinearElastic", "parameters": {"E": 210000, "nu": 0.3}},
        ["u"],
    ),
}


def test_the_registry_is_read_from_the_schema():
    registry = formulations()
    assert list(registry) == ["u", "u-p-J", "u-isochoric"]
    assert [
        (f.label, f.group, f.body, f.fields, f.cells, f.material)
        for f in registry.values()
    ] == [
        ("Displacement (u)", "Displacement", "fem.SolidBody", "u", None, "volumetric"),
        (
            "Nearly incompressible (u, p, J)",
            "Nearly incompressible",
            "nearly_incompressible",
            "mixed",
            None,
            "isochoric",
        ),
        (
            "Isochoric part only (third medium)",
            "Third medium",
            "fem.SolidBody",
            "u",
            None,
            "none",
        ),
    ]
    # the dual fields of mixed fields, which a step that leaves out the section holds
    assert [f.dual for f in registry.values()] == [False, True, False]
    section = {"formulation": "u-p-J"}
    assert formulation_of(section) is registry["u-p-J"]


def test_every_definition_has_what_the_registry_needs():
    defs = schema()["$defs"]
    for ref in defs["SectionAdd"]["oneOf"]:
        node = defs[ref["$ref"].split("/")[-1]]
        assert set(node) >= {"description", "x-label", "x-group", "x-felupe"}
        felupe = node["x-felupe"]
        assert set(felupe) == {"body", "fields", "cells", "material"}
        # a builder of its fields and of its solid body
        assert felupe["body"] in sections.BODIES
        assert felupe["fields"] in sections.FIELDS
        assert felupe["material"] in MATERIALS
        assert felupe["cells"] == "all" or set(felupe["cells"]) <= set(REGIONS)
        assert node["properties"]["command"] == {"const": "section.add"}
        assert "formulation" in node["required"]


@pytest.mark.parametrize("kind", KINDS)
def test_a_formulation_fits_a_material(kind):
    material, fitting = KINDS[kind]
    assert [f.name for f in formulations().values() if f.fits(material)] == fitting


def test_the_first_formulation_of_a_kind_of_material():
    assert [first(m) for m in MATERIALS if m != "any"] == ["u", "u-p-J", "u-isochoric"]


def test_the_documents_of_today_stay_valid():
    """The schema version stays 3: a section of every formulation is valid, and a
    bulk modulus belongs to u-p-J only."""
    section = {"command": "section.add", "name": "s", "cellset": "c", "material": "m"}

    def document(**fields):
        return {"schema_version": 3, "commands": [{**section, **fields}]}

    assert schema_errors(document(formulation="u")) == []
    assert schema_errors(document(formulation="u-isochoric")) == []
    assert schema_errors(document(formulation="u-p-J", bulk=5000)) == []
    log = document(formulation="u-p-J", bulk=5000, volumetric="log")
    assert schema_errors(log) == []
    assert schema_errors(document(formulation="u-p-J"))
    assert schema_errors(document(formulation="u", bulk=5000))
    assert schema_errors(document(formulation="u-isochoric", volumetric="log"))
    assert schema_errors(document(formulation="u-p-J-condensed", bulk=5000))


def test_no_comparison_of_a_formulation_is_left():
    """The code reads the registry instead of comparing the value of a formulation
    (ADR 0024): a new formulation is a definition."""
    sources = [
        *(ROOT / "python" / "felupe_studio").glob("*.py"),
        *(
            path
            for path in (ROOT / "app" / "src").rglob("*.ts*")
            if ".test." not in path.name
        ),
    ]
    pattern = re.compile(
        r"formulation['\"]?\]?\s*[!=]==?\s*['\"]u['\"-]"
        r"|['\"]u(-p-J|-isochoric)?['\"]\s*[!=]==?"
    )
    found = [
        f"{path.relative_to(ROOT)}: {line.strip()}"
        for path in sources
        for line in path.read_text(encoding="utf-8").splitlines()
        if pattern.search(line)
    ]
    assert found == []
