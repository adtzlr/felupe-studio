"""The formulation registry of the sections (ADR 0024, #419)."""

import re
from pathlib import Path

import felupe as fem
import pytest

from felupe_studio import sections
from felupe_studio._helpers import CONDENSED, REGIONS, condensed_region
from felupe_studio.commands import schema, schema_errors
from felupe_studio.formulations import (
    MATERIALS,
    alternatives,
    cell_problem,
    first,
    formulation_of,
    formulations,
    sibling,
)

ROOT = Path(__file__).parents[1]

# a material of every kind, and the formulations that take it
KINDS = {
    "incompressible": (
        {"model": "NeoHooke", "parameters": {"mu": 1}},
        ["u-p-J", "u-p-J-condensed", "u-p-J-mixed", "u-isochoric"],
    ),
    "with a bulk modulus": (
        {"model": "NeoHooke", "parameters": {"mu": 1, "bulk": 5000}},
        ["u", "u-p-J-three-field"],
    ),
    "compressible": (
        {"model": "NeoHookeCompressible", "parameters": {"mu": 1, "lmbda": 5000}},
        ["u", "u-p-J-three-field"],
    ),
    "strain-based": (
        {"model": "LinearElastic", "parameters": {"E": 210000, "nu": 0.3}},
        ["u", "u-p-J-three-field"],
    ),
}

NEARLY_INCOMPRESSIBLE = "Nearly incompressible"


def test_the_registry_is_read_from_the_schema():
    registry = formulations()
    assert list(registry) == [
        "u",
        "u-p-J",
        "u-p-J-condensed",
        "u-p-J-mixed",
        "u-p-J-three-field",
        "u-isochoric",
    ]
    assert [
        (f.label, f.group, f.body, f.fields, f.cells, f.material)
        for f in registry.values()
    ] == [
        ("Displacement (u)", "Displacement", "fem.SolidBody", "u", None, "volumetric"),
        (
            "Automatic",
            NEARLY_INCOMPRESSIBLE,
            "nearly_incompressible",
            "automatic",
            None,
            "isochoric",
        ),
        (
            "Condensed per cell",
            NEARLY_INCOMPRESSIBLE,
            "fem.SolidBodyNearlyIncompressible",
            "condensed",
            CONDENSED,
            "isochoric",
        ),
        (
            "Mixed fields",
            NEARLY_INCOMPRESSIBLE,
            "fem.NearlyIncompressible",
            "mixed",
            None,
            "isochoric",
        ),
        (
            "Three-field variation",
            NEARLY_INCOMPRESSIBLE,
            "fem.ThreeFieldVariation",
            "mixed",
            None,
            "volumetric",
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
    assert [f.dual for f in registry.values()] == [
        False,
        True,
        False,
        True,
        True,
        False,
    ]
    # every formulation says when to use it, the hint of the form (#420)
    assert all(f.hint for f in registry.values())
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
    assert [first(m) for m in MATERIALS] == ["u", "u-p-J", "u-isochoric"]


def test_a_formulation_of_the_same_menu_takes_a_material():
    """The messages of the rule name it (#420), e.g. the three-field variation for a
    material with a volumetric part on a section u-p-J."""
    incompressible, with_bulk = KINDS["incompressible"][0], KINDS["strain-based"][0]
    registry = formulations()
    assert sibling(registry["u-p-J"], with_bulk) == "u-p-J-three-field"
    assert sibling(registry["u-p-J-mixed"], with_bulk) == "u-p-J-three-field"
    assert sibling(registry["u-p-J-three-field"], incompressible) == "u-p-J"
    assert sibling(registry["u"], incompressible) is None
    assert sibling(registry["u-isochoric"], with_bulk) is None


def test_the_cells_of_a_formulation():
    """Condensed per cell takes hexahedrons and quads, linear or quadratic (#420):
    the registry, the helper of the script and the message of the checks agree."""
    condensed = formulations()["u-p-J-condensed"]
    assert set(CONDENSED) <= set(REGIONS)
    assert [t for t in REGIONS if condensed.takes(t)] == list(CONDENSED)
    assert condensed.kinds == "hexahedrons and quads"
    assert all(f.takes("tetra") for f in formulations().values() if f is not condensed)
    assert alternatives(condensed, "triangle6") == ["u-p-J", "u-p-J-mixed"]
    section = {"name": "rubber", "formulation": "u-p-J-condensed"}
    assert cell_problem(section, "tetra10") == (
        "Condensed per cell (u-p-J-condensed) takes hexahedrons and quads, not the "
        "tetra10 cells of 'rubber'. Use 'u-p-J' or 'u-p-J-mixed'."
    )
    assert cell_problem(section, "hexahedron27") is None
    assert cell_problem({"name": "rubber", "formulation": "u-p-J"}, "tetra") is None
    # the script says the same when it runs
    with pytest.raises(ValueError, match="not tetra cells. Use 'u-p-J' or"):
        condensed_region(fem.Cube(n=2).triangulate())
    region = condensed_region(fem.mesh.convert(fem.Rectangle(n=2), order=2))
    assert isinstance(region, fem.RegionQuadraticQuad)


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
    assert schema_errors(document(formulation="u-p-J-automatic", bulk=5000))
    # the ways of u-p-J (#420): a bulk modulus of the section, except the three-field
    # variation, which takes the volumetric part of the material
    for name in ("u-p-J-condensed", "u-p-J-mixed"):
        assert schema_errors(document(formulation=name, bulk=5000)) == []
        assert schema_errors(document(formulation=name, bulk=1, volumetric="log")) == []
        assert schema_errors(document(formulation=name))
    assert schema_errors(document(formulation="u-p-J-three-field")) == []
    assert schema_errors(document(formulation="u-p-J-three-field", bulk=5000))


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
        r"|['\"]u(-p-J(-[a-z-]+)?|-isochoric)?['\"]\s*[!=]==?"
    )
    found = [
        f"{path.relative_to(ROOT)}: {line.strip()}"
        for path in sources
        for line in path.read_text(encoding="utf-8").splitlines()
        if pattern.search(line)
    ]
    assert found == []
