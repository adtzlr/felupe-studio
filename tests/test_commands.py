import copy
import json
from pathlib import Path

import pytest

from felupe_studio import commands
from felupe_studio._helpers import REGIONS

DATA = Path(__file__).parent / "data"


@pytest.fixture
def document():
    return json.loads((DATA / "two_sections.json").read_text(encoding="utf-8"))


def find(document, name):
    return next(c for c in document["commands"] if c["name"] == name)


def test_schema_is_valid_json_schema():
    from jsonschema import Draft202012Validator

    Draft202012Validator.check_schema(commands.schema())
    assert commands.schema()["properties"]["schema_version"]["const"] == (
        commands.SCHEMA_VERSION
    )


def test_every_command_has_a_kind():
    defs = commands.schema()["$defs"]

    def consts(definition):
        if "oneOf" in definition:
            for ref in definition["oneOf"]:
                yield from consts(defs[ref["$ref"].split("/")[-1]])
        else:
            yield definition["properties"]["command"]["const"]

    assert set(consts(defs["Command"])) == set(commands.KINDS)


def test_cell_types_have_a_region():
    mesh = commands.schema()["$defs"]["MeshImport"]["properties"]
    assert mesh["cell_type"]["enum"] == list(REGIONS)


def test_reserved_keywords_are_python_keywords():
    import keyword

    keywords, names, prefixes = commands.reserved()
    assert keywords == set(keyword.kwlist)
    assert "field" in names and "field_" in prefixes


def test_valid_document(document):
    assert commands.errors(document) == []
    assert commands.validate(document) is document


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.update(schema_version=4),
        lambda d: d["commands"].append({"command": "mesh.delete", "name": "a"}),
        lambda d: find(d, "hard").update(name="1hard"),
        lambda d: find(d, "hard").update(name="h" * 25),
        lambda d: find(d, "hard").pop("value"),
        lambda d: find(d, "umat_hard")["parameters"].update(nu=0.5),
        lambda d: find(d, "umat_hard")["parameters"].update(mu=1),
        lambda d: find(d, "umat_hard").update(model="Ogden"),
        lambda d: find(d, "section_soft").pop("bulk"),
        lambda d: find(d, "section_hard").update(bulk=100),
        lambda d: find(d, "section_hard").update(formulation="u-p"),
        lambda d: find(d, "section_hard").update(volumetric="log"),
        lambda d: find(d, "specimen").update(scale=0),
        lambda d: find(d, "specimen").update(scale=-1000),
        lambda d: find(d, "section_soft").update(volumetric="quadratic"),
        lambda d: find(d, "specimen").update(cell_type="wedge"),
        lambda d: find(d, "left").update(select={"axis": "w", "value": 0}),
        lambda d: find(d, "left").update(select={"ids": []}),
        lambda d: find(d, "fixed").update(constrained=[]),
        lambda d: find(d, "fixed").update(constrained=["x", "x"]),
        lambda d: find(d, "step_1")["ramp"].update(num=0),
        lambda d: find(d, "job_1").update(steps=[]),
        lambda d: find(d, "job_1").update(cutback=True),
        lambda d: find(d, "job_1").update(cutback={"factor": 1}),
        lambda d: find(d, "job_1").update(cutback={"max_cutbacks": 0}),
        lambda d: find(d, "job_1").update(cutback={"growth": 0.5}),
        lambda d: find(d, "job_1").update(cutback={"steps": 2}),
        lambda d: find(d, "job_1").update(maxiter=0),
        lambda d: find(d, "job_1").update(maxiter=1.5),
        lambda d: d["commands"].insert(1, {"command": "mesh.merge", "name": "m"}),
        lambda d: d["commands"].insert(
            1, {"command": "mesh.merge", "name": "m", "decimals": 16}
        ),
        lambda d: d["commands"].insert(
            0, {"command": "model.settings", "name": "s", "units": {"length": "mm"}}
        ),
        lambda d: d["commands"].__setitem__(
            slice(0, 0),
            [{"command": "model.settings", "name": f"s{i}"} for i in range(2)],
        ),
    ],
)
def test_schema_errors(document, change):
    change(document)
    assert commands.errors(document)
    with pytest.raises(commands.ValidationError):
        commands.validate(document)


@pytest.mark.parametrize(
    "change, message",
    [
        (lambda d: find(d, "hard").update(mesh="nomesh"), "unknown mesh 'nomesh'"),
        (
            lambda d: find(d, "section_hard").update(cellset="umat_hard"),
            "is a material",
        ),
        (lambda d: find(d, "fixed").update(pointset="right2"), "unknown pointset"),
        (lambda d: find(d, "step_1").update(sections=["hard"]), "is a cellset"),
        (
            lambda d: find(d, "step_1")["ramp"]["items"][0].update(target="left"),
            "ramps unknown",
        ),
        (lambda d: find(d, "job_1").update(curve="fixed2"), "unknown boundary"),
        (lambda d: find(d, "soft").update(name="hard"), "already used"),
        (lambda d: find(d, "job_1").update(name="lambda"), "reserved"),
        (lambda d: find(d, "job_1").update(name="field"), "reserved"),
        (lambda d: find(d, "job_1").update(name="solid_a"), "reserved"),
        (lambda d: find(d, "job_1").update(name="region_a"), "reserved"),
        (lambda d: find(d, "job_1").update(name="ramp_a"), "reserved"),
        (lambda d: find(d, "specimen").pop("tag"), "imported without a tag"),
        (
            lambda d: (
                find(d, "section_soft").update(formulation="u")
                or find(d, "section_soft").pop("bulk")
            ),
            "without a bulk modulus",
        ),
    ],
)
def test_reference_errors(document, change, message):
    change(document)
    messages = commands.errors(document)
    assert any(message in m for m in messages), messages


def test_references_must_be_defined_before_use(document):
    cmds = document["commands"]
    cmds.insert(0, cmds.pop(cmds.index(find(document, "job_1"))))
    assert any("unknown step 'step_1'" in m for m in commands.errors(document))


def test_neohooke_with_bulk_in_displacement_formulation(document):
    find(document, "umat_soft")["parameters"]["bulk"] = 5000
    section = find(document, "section_soft")
    section["formulation"] = "u"
    section.pop("bulk")
    assert commands.errors(document) == []


def test_one_merge(document):
    merge = {"command": "mesh.merge", "name": "merge", "decimals": 6}
    document["commands"].insert(1, merge)
    assert commands.errors(document) == []
    document["commands"].insert(2, {**merge, "name": "merge_2"})
    assert any("only one mesh.merge" in m for m in commands.errors(document))


def test_document_is_not_modified(document):
    before = copy.deepcopy(document)
    commands.errors(document)
    assert document == before
