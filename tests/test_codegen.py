import copy
import json
import runpy
import shutil
import subprocess
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio.codegen import codegen
from felupe_studio.commands import ValidationError

DATA = Path(__file__).parent / "data"


@pytest.fixture
def two_sections():
    return json.loads((DATA / "two_sections.json").read_text(encoding="utf-8"))


def bar(n=(13, 5, 5)):
    """Bar 3 x 1 x 1 with hexahedrons, tag 1 for x < 1.5 and tag 2 otherwise."""
    mesh = fem.Cube(b=(3, 1, 1), n=n)
    tag = np.where(mesh.points[mesh.cells].mean(axis=1)[:, 0] < 1.5, 1, 2)
    return mesh, tag


def write(filename, mesh, tag=None, cell_type=None):
    cell_data = {} if tag is None else {"material": [tag]}
    meshio.Mesh(
        mesh.points, [(cell_type or mesh.cell_type, mesh.cells)], cell_data=cell_data
    ).write(filename)


def run(document, directory, monkeypatch):
    """Generate the script, write it to the directory and run it there."""
    script = Path(directory) / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(directory)
    return runpy.run_path(str(script))


def force(namespace, job="job_1"):
    return np.array(namespace[job].y)[:, 0]


def uniaxial(name="job_1"):
    """Commands for a uniaxial test of a bar: left end fixed, right end moved in x."""
    return [
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 3},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "move",
            "pointset": "right",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "step_1",
            "ramp": {"boundary": "move", "end": 0.5, "num": 5},
        },
        {"command": "job.add", "name": name, "steps": ["step_1"], "curve": "move"},
    ]


def material(name="umat"):
    return {
        "command": "material.add",
        "name": name,
        "model": "NeoHookeCompressible",
        "parameters": {"mu": 1.0, "lmbda": 2.0},
    }


def section(name, cellset, umat="umat"):
    return {
        "command": "section.add",
        "name": name,
        "cellset": cellset,
        "material": umat,
        "formulation": "u",
    }


def test_script_passes_ruff(two_sections, tmp_path):
    script = tmp_path / "script.py"
    script.write_text(codegen(two_sections), encoding="utf-8")
    ruff = shutil.which("ruff")
    if ruff is None:
        pytest.skip("ruff is not installed")
    check = [ruff, "check", "--isolated", "--select", "E,F,W,I", str(script)]
    assert subprocess.run(check, capture_output=True).returncode == 0
    fmt = [ruff, "format", "--isolated", "--check", str(script)]
    assert subprocess.run(fmt, capture_output=True).returncode == 0


def test_two_sections_matches_reference(two_sections, tmp_path, monkeypatch):
    # reference: the hand-written FElupe script checked with FElupe 12.0.0
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    namespace = run(two_sections, tmp_path, monkeypatch)
    assert np.isclose(force(namespace)[-1], 0.66322, rtol=1e-5)
    assert len(namespace["field"].fields) == 3  # u, and p, J of the soft section


def single_body(tmp_path, monkeypatch):
    mesh, _ = bar()
    write(tmp_path / "bar.vtu", mesh)
    document = {
        "schema_version": 1,
        "commands": [
            {"command": "mesh.import", "name": "specimen", "file": "bar.vtu"},
            {"command": "cellset.from_file", "name": "all_cells", "mesh": "specimen"},
            material(),
            section("body", "all_cells"),
            *uniaxial(),
        ],
    }
    return force(run(document, tmp_path, monkeypatch))


def test_single_body_matches_felupe(tmp_path, monkeypatch):
    mesh, _ = bar()
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    x = mesh.points[:, 0]
    boundaries = {
        "fixed": fem.Boundary(field[0], mask=np.isclose(x, 0)),
        "move": fem.Boundary(field[0], mask=np.isclose(x, 3), skip=(0, 1, 1)),
    }
    solid = fem.SolidBody(fem.NeoHookeCompressible(mu=1.0, lmbda=2.0), field)
    move = fem.math.linsteps([0, 0.5], num=5)
    step = fem.Step([solid], ramp={boundaries["move"]: move}, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])
    job.evaluate(verbose=0)

    assert np.allclose(single_body(tmp_path, monkeypatch), np.array(job.y)[:, 0])


def test_sections_from_tags_and_files_match_single_body(tmp_path, monkeypatch):
    reference = single_body(tmp_path, monkeypatch)

    # one file with tags, two sections with the same material
    mesh, tag = bar()
    write(tmp_path / "tagged.vtu", mesh, tag)
    tagged = {
        "schema_version": 1,
        "commands": [
            {
                "command": "mesh.import",
                "name": "m",
                "file": "tagged.vtu",
                "tag": "material",
            },
            {"command": "cellset.from_tag", "name": "a", "mesh": "m", "value": 1},
            {"command": "cellset.from_tag", "name": "b", "mesh": "m", "value": 2},
            material(),
            section("sa", "a"),
            section("sb", "b"),
            *uniaxial(),
        ],
    }
    assert np.allclose(force(run(tagged, tmp_path, monkeypatch)), reference)

    # two files with separate points arrays
    write(tmp_path / "left.vtu", fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5)))
    write(tmp_path / "right.vtu", fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(7, 5, 5)))
    files = {
        "schema_version": 1,
        "commands": [
            {"command": "mesh.import", "name": "ml", "file": "left.vtu"},
            {"command": "mesh.import", "name": "mr", "file": "right.vtu"},
            {"command": "cellset.from_file", "name": "a", "mesh": "ml"},
            {"command": "cellset.from_file", "name": "b", "mesh": "mr"},
            material(),
            section("sa", "a"),
            section("sb", "b"),
            *uniaxial(),
        ],
    }
    namespace = run(files, tmp_path, monkeypatch)
    assert len(namespace["points"]) == mesh.npoints  # duplicate points merged
    assert np.allclose(force(namespace), reference)


def test_lower_dimensional_and_split_cell_blocks(tmp_path, monkeypatch):
    # tetrahedrons, split into two blocks like Gmsh entities, plus a triangle block
    mesh, _ = bar(n=(7, 3, 3))
    tetra = mesh.triangulate()
    centers = tetra.points[tetra.cells].mean(axis=1)[:, 0]
    a, b = tetra.cells[centers < 1.5], tetra.cells[centers >= 1.5]
    faces = np.array([[0, 1, 2]])
    meshio.Mesh(
        tetra.points,
        [("tetra", a), ("triangle", faces), ("tetra", b)],
        cell_data={"material": [np.ones(len(a)), [9], 2 * np.ones(len(b))]},
    ).write(tmp_path / "tetra.vtu")

    document = {
        "schema_version": 1,
        "commands": [
            {
                "command": "mesh.import",
                "name": "m",
                "file": "tetra.vtu",
                "tag": "material",
            },
            {"command": "cellset.from_tag", "name": "a", "mesh": "m", "value": 1},
            {"command": "cellset.from_tag", "name": "b", "mesh": "m", "value": 2},
            material(),
            section("sa", "a"),
            section("sb", "b"),
            *uniaxial(),
        ],
    }
    namespace = run(document, tmp_path, monkeypatch)
    assert namespace["m"].cell_type == "tetra"
    assert len(namespace["a"].cells) == len(a)
    assert len(namespace["b"].cells) == len(b)
    assert force(namespace)[-1] > 0


def test_point_ids_and_job_without_curve(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    reference = run(two_sections, tmp_path, monkeypatch)
    ids = np.flatnonzero(reference["left"]).tolist()

    document = copy.deepcopy(two_sections)
    for cmd in document["commands"]:
        if cmd["name"] == "left":
            cmd["select"] = {"ids": ids}
        if cmd["name"] == "job_1":
            cmd.pop("curve")
    namespace = run(document, tmp_path, monkeypatch)

    assert np.array_equal(namespace["left"], reference["left"])
    assert isinstance(namespace["job_1"], fem.Job)
    assert not isinstance(namespace["job_1"], fem.CharacteristicCurve)


def test_merge_decimals(two_sections):
    assert "fem.field.merge([field_section_hard, field_section_soft])" in codegen(
        two_sections
    )
    two_sections["commands"].insert(
        1, {"command": "mesh.merge", "name": "merge", "decimals": 6}
    )
    script = codegen(two_sections)
    assert "[field_section_hard, field_section_soft], decimals=6" in script


def test_evaluate_false(two_sections):
    script = codegen(two_sections, evaluate=False)
    assert ".evaluate(" not in script
    assert "job_1 = fem.CharacteristicCurve(" in script


def rename(document, length):
    """Extend every name of the command list to the given length."""
    names = {c["name"]: c["name"].ljust(length, "x") for c in document["commands"]}
    refs = ("mesh", "cellset", "material", "pointset", "boundary", "curve")

    def replace(obj):
        if isinstance(obj, dict):
            return {
                k: names.get(v, v) if k in ("name", *refs) else replace(v)
                for k, v in obj.items()
            }
        if isinstance(obj, list):
            return [names.get(v, v) if isinstance(v, str) else replace(v) for v in obj]
        return obj

    return replace(document)


def test_longest_names_are_wrapped(two_sections, tmp_path, monkeypatch):
    document = rename(two_sections, 24)
    script = codegen(document)
    assert max(len(line) for line in script.splitlines()) <= 88

    # a ramp of more boundaries is exploded like ruff format would do it
    ramped = copy.deepcopy(document)
    step = next(c for c in ramped["commands"] if c["command"] == "step.add")
    fixed = next(
        c["name"]
        for c in ramped["commands"]
        if c["command"] == "boundary.add" and c["name"] != step["ramp"]["boundary"]
    )
    step["ramp"]["also"] = [fixed]
    long = codegen(ramped)
    assert "    ramp={\n" in long
    assert max(len(line) for line in long.splitlines()) <= 88

    ruff = shutil.which("ruff")
    if ruff:
        for text in (script, long):
            path = tmp_path / "script.py"
            path.write_text(text, encoding="utf-8")
            fmt = [ruff, "format", "--isolated", "--check", str(path)]
            assert subprocess.run(fmt, capture_output=True).returncode == 0

    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    namespace = run(document, tmp_path, monkeypatch)
    assert np.isclose(
        force(namespace, job="job_1".ljust(24, "x"))[-1], 0.66322, rtol=1e-5
    )


def test_invalid_documents(two_sections):
    with pytest.raises(ValidationError):
        codegen({"schema_version": 1, "commands": [{"command": "mesh.import"}]})

    without_sections = {
        "schema_version": 1,
        "commands": [
            {
                "command": "pointset.add",
                "name": "p",
                "select": {"axis": "x", "value": 0},
            }
        ],
    }
    with pytest.raises(ValidationError, match="at least one section"):
        codegen(without_sections)


def test_mooney_rivlin_like_neo_hooke(tmp_path, monkeypatch):
    # with C01 = 0, Mooney-Rivlin (tensortrax) is Neo-Hooke with mu = 2 C10
    mesh, _ = bar(n=(4, 2, 2))
    write(tmp_path / "bar.vtu", mesh)
    curves = {}
    for model, parameters in [
        ("NeoHooke", {"mu": 1.0}),
        ("MooneyRivlin", {"C10": 0.5, "C01": 0.0}),
    ]:
        document = {
            "schema_version": 1,
            "commands": [
                {"command": "mesh.import", "name": "m", "file": "bar.vtu"},
                {"command": "cellset.from_file", "name": "all", "mesh": "m"},
                {
                    "command": "material.add",
                    "name": "umat",
                    "model": model,
                    "parameters": {**parameters, "bulk": 50.0},
                },
                section("body_u", "all"),
                *uniaxial(),
            ],
        }
        curves[model, "u"] = force(run(document, tmp_path, monkeypatch))
        # incompressible without bulk, in the u-p-J formulation
        material = document["commands"][2]
        material["parameters"].pop("bulk")
        document["commands"][3].update(formulation="u-p-J", bulk=5000.0)
        curves[model, "upJ"] = force(run(document, tmp_path, monkeypatch))
    for kind in ("u", "upJ"):
        np.testing.assert_allclose(
            curves["MooneyRivlin", kind], curves["NeoHooke", kind], rtol=1e-10
        )
        assert curves["NeoHooke", kind][-1] > 0


def solid_meshes():
    """The bar 3 x 1 x 1 with every supported type of solid cells."""
    hexahedron = fem.Cube(b=(3, 1, 1), n=(4, 2, 2))
    tetra = hexahedron.triangulate()
    return {
        "hexahedron": hexahedron,
        "hexahedron20": fem.mesh.convert(hexahedron, order=2),
        "hexahedron27": fem.mesh.convert(
            hexahedron, order=2, calc_midfaces=True, calc_midvolumes=True
        ),
        "tetra": tetra,
        "tetra10": fem.mesh.add_midpoints_edges(tetra, cell_type_new="tetra10"),
    }


@pytest.mark.parametrize("cell_type", list(solid_meshes()))
@pytest.mark.parametrize("formulation", ["u", "u-p-J"])
def test_every_cell_type_and_formulation(cell_type, formulation, tmp_path, monkeypatch):
    mesh = solid_meshes()[cell_type]
    assert mesh.cell_type == cell_type
    write(tmp_path / "bar.vtu", mesh)
    umat = {"command": "material.add", "name": "umat", "model": "NeoHooke"}
    body = section("body", "all")
    if formulation == "u":
        umat["parameters"] = {"mu": 1.0, "bulk": 5.0}
    else:
        umat["parameters"] = {"mu": 1.0}
        body.update(formulation="u-p-J", bulk=5.0)
    document = {
        "schema_version": 1,
        "commands": [
            {"command": "mesh.import", "name": "m", "file": "bar.vtu"},
            {"command": "cellset.from_file", "name": "all", "mesh": "m"},
            umat,
            body,
            *uniaxial(),
        ],
    }
    namespace = run(document, tmp_path, monkeypatch)
    curve = force(namespace)
    # the forces of all elements and formulations agree within about 10 %
    assert 0.38 < curve[-1] < 0.47, curve
    if (cell_type, formulation) == ("tetra", "u-p-J"):
        # MINI element: a bubble point in every cell
        assert namespace["region_body"].mesh.cell_type == "tetra5"
