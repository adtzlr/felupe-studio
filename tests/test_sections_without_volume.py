"""Sections without volume (#429): a section of one degenerate cell, all its points one
point, e.g. an empty part of a mesh script (#418), has the volume 0 and forces and
stiffness that are NaN. In a script with meshes of scripts, the steps leave out its
solid body when the script runs (``with_volume()``) and hold the dual fields of its
mixed fields (``fields_without_volume()``, #428), so it is off in every step, also
in a step that lists it. The summaries of the meshes give the volumes (the areas of
2D cells), and the results of such a section are NaN, skipped by the ranges and the
extremes and written to the exports."""

import contextlib
import io
import json
import shutil
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio import meshes, resultfile, results, runner
from felupe_studio._helpers import DIMENSIONS, REGIONS, cell_volumes, mixed_region
from felupe_studio.codegen import codegen
from felupe_studio.commands import errors

GOLDEN = Path(__file__).parent / "golden"
SANDWICH = Path(__file__).parents[1] / "app" / "samples" / "06_sandwich-spring"

# the lines of the guide at the end of the script of the sandwich spring: without
# sheets, one degenerate cell on a point of the soft layers
WITHOUT_SHEETS = """
sheets = globals().get("sheets", 1)

# without sheets: one degenerate cell on a point of the soft layers
if sheets == 0:
    soft = mesh["soft"]
    mesh["metal"] = fem.Mesh(
        points=soft.points[soft.cells[:1, 0]],
        cells=np.zeros((1, 8), dtype=int),
        cell_type="hexahedron",
    )
"""

# the region of a degenerate cell divides by its volume 0
pytestmark = [
    pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning"),
    pytest.mark.filterwarnings("ignore:divide by zero encountered:RuntimeWarning"),
    pytest.mark.filterwarnings("ignore:Negative volumes for cells:UserWarning"),
]

# a soft block 0 <= x, y, z <= 1 and a sheet of hexahedrons or tetrahedrons on top of
# it, or without sheets the sheet as one degenerate cell on the middle point of the
# soft block
SCRIPT = """import felupe as fem
import numpy as np

sheets = globals().get("sheets", 1)
tetra = globals().get("tetra", 0)
soft = fem.Cube(n=3)
metal = fem.Cube(a=(0, 0, 1), b=(1, 1, 1.25), n=(3, 3, 2))
if tetra:
    metal = metal.triangulate()
if sheets == 0:
    metal = fem.Mesh(
        points=np.full((1, 3), 0.5),
        cells=np.zeros((1, metal.cells.shape[1]), dtype=int),
        cell_type=metal.cell_type,
    )
mesh = {"soft": soft, "metal": metal}
"""

# the sections of the sheets: a formulation, a material and a cell type
SHEETS = {
    "u": ("u", "steel", "hexahedron"),
    "u-p-J condensed": ("u-p-J", "rubber", "hexahedron"),
    "u-p-J mixed": ("u-p-J", "rubber", "tetra"),
}


@pytest.fixture
def folder(tmp_path, monkeypatch):
    (tmp_path / "parts.py").write_text(SCRIPT, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def model(sheets=0, kind="u", metal=True, steps=None, load=False):
    """The soft block, fixed at x = 0 and pulled at x = 1, with the sheets of the
    script as a section of a kind of :data:`SHEETS` (or without them): one
    degenerate cell for ``sheets=0``. The step ``pull`` has all sections by
    default."""
    formulation, material, cell_type = SHEETS[kind]
    commands = [
        {
            "command": "parameter.add",
            "name": "sheets",
            "value": sheets,
            "integer": True,
        },
        {
            "command": "parameter.add",
            "name": "tetra",
            "value": int(cell_type == "tetra"),
            "integer": True,
        },
        {
            "command": "mesh.script",
            "name": "soft_mesh",
            "file": "parts.py",
            "item": "soft",
        },
        {"command": "cellset.from_file", "name": "soft_cells", "mesh": "soft_mesh"},
        {
            "command": "material.add",
            "name": "foam",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1.0, "lmbda": 2.0},
        },
        {
            "command": "material.add",
            "name": "steel",
            "model": "LinearElasticLargeStrain",
            "parameters": {"E": 210.0, "nu": 0.3},
        },
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHooke",
            "parameters": {"mu": 10.0},
        },
        {
            "command": "section.add",
            "name": "soft",
            "cellset": "soft_cells",
            "material": "foam",
            "formulation": "u",
        },
    ]
    if metal:
        section = {"formulation": formulation}
        if formulation == "u-p-J":
            section["bulk"] = 50.0
        commands += [
            {
                "command": "mesh.script",
                "name": "metal_mesh",
                "file": "parts.py",
                "item": "metal",
            },
            {
                "command": "cellset.from_file",
                "name": "metal_cells",
                "mesh": "metal_mesh",
            },
            {
                "command": "section.add",
                "name": "metal",
                "cellset": "metal_cells",
                "material": material,
                **section,
            },
        ]
    commands += [
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 1},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
    ]
    if load:
        commands.append(
            {
                "command": "load.add",
                "name": "force",
                "points": "right",
                "force": [0.2, 0, 0],
            }
        )
        step = {"command": "step.add", "name": "pull", "ramp": ramp("force")}
    else:
        commands.append(
            {
                "command": "boundary.add",
                "name": "move",
                "pointset": "right",
                "constrained": ["x"],
            }
        )
        step = {"command": "step.add", "name": "pull", "ramp": ramp("move")}
    if steps is not None:
        step["sections"] = steps
    curve = "force" if load else "move"
    commands += [
        step,
        {"command": "job.add", "name": "job", "steps": ["pull"], "curve": curve},
    ]
    return {"schema_version": 3, "commands": commands}


def ramp(target):
    return {"num": 3, "items": [{"target": target, "start": 0, "end": 0.3}]}


def run(document, text=None):
    """The namespace of the script of a command list (or of a text), after its
    jobs."""
    assert errors(document) == []
    text = codegen(document) if text is None else text
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(text, namespace)  # noqa: S102
    return namespace


def forces(namespace):
    return np.array(namespace["job"].y)[:, 0]


@pytest.mark.parametrize("cell_type", list(REGIONS))
def test_the_volume_of_a_degenerate_cell_is_zero(cell_type):
    """A degenerate cell of every cell type has exactly the volume 0, also a quadratic
    one and the cells of the MINI element of mixed fields, whose bubble point (the
    mean of the corners) may be off by a rounding error."""
    npoints = REGIONS[cell_type](fem.Cube(n=2), grad=False).element.points.shape[0]
    dim = DIMENSIONS[cell_type]
    for point in ([0.1, 1 / 3, 7.3], [123.456, -0.7, 1e-3], [1e3, 2e3, -3e3]):
        mesh = fem.Mesh(
            np.array([point[:dim]]), np.zeros((1, npoints), dtype=int), cell_type
        )
        assert cell_volumes(mesh).sum() == 0
        assert cell_volumes(mixed_region(mesh).mesh).sum() == 0


@pytest.mark.parametrize(
    "mesh",
    [fem.Cube(n=3), fem.Cube(n=3).triangulate(), fem.Rectangle(n=3)],
    ids=["hexahedron", "tetra", "quad"],
)
def test_the_volumes_of_cells_are_those_of_their_region(mesh):
    """The volumes of the cells are those of their region, of every cell measured
    from its first point, and of the cells of the MINI element those of their
    corners."""
    mesh = mesh.copy()
    rng = np.random.default_rng(429)
    mesh.points[:] += rng.uniform(-0.05, 0.05, size=mesh.points.shape)
    region = REGIONS[mesh.cell_type](mesh)
    np.testing.assert_allclose(cell_volumes(mesh), region.dV.sum(axis=0), rtol=1e-12)
    total = cell_volumes(mixed_region(mesh).mesh).sum()
    assert total == pytest.approx(region.dV.sum(), rel=1e-12)


def test_the_volumes_in_the_summaries(folder):
    """The summaries of the meshes of scripts, of files and of tools give the volume
    of the solid cells and of the cells of every tag, zero of a degenerate cell."""
    info = json.loads(meshes.make("parts.py", {"sheets": 0}, "metal")[0])
    assert info["solids"][0]["volume"] == 0
    info = json.loads(meshes.make("parts.py", {"sheets": 1}, "metal")[0])
    assert info["solids"][0]["volume"] == pytest.approx(0.25)
    tool = {
        "command": "mesh.generate",
        "name": "block",
        "tool": "Rectangle",
        "parameters": {"a": [0, 0], "b": [2, 3], "n": [3, 4]},
    }
    info = json.loads(meshes.generate([tool], "block")[0])
    # the area of 2D cells
    assert info["solids"][0]["volume"] == pytest.approx(6)


@pytest.mark.parametrize("kind", list(SHEETS))
def test_a_section_without_volume_is_off(folder, kind):
    """The sandwich of #429 with its sheets as one degenerate cell on the middle point
    of the soft block: in the step, by default and when the step lists it, and in the
    curve of a point load, the section is off. The force is that of the soft block
    alone, of the formulation u and u-p-J, condensed (linear hexahedrons) and with
    mixed fields (tetrahedrons, whose dual fields are held, #428)."""
    alone = forces(run(model(metal=False)))
    assert alone[-1] > 0.1
    for steps in (None, ["soft", "metal"]):
        namespace = run(model(kind=kind, steps=steps))
        np.testing.assert_allclose(forces(namespace), alone, rtol=1e-8, atol=1e-12)
        assert [type(item).__name__ for item in namespace["pull"].items] == [
            "SolidBody"
        ]
    by_load = forces(run(model(kind=kind, load=True)))
    without = forces(run(model(metal=False, load=True)))
    assert without[-1] > 0.1
    np.testing.assert_allclose(by_load, without, rtol=1e-8, atol=1e-12)


def test_the_script_follows_the_parameters(folder):
    """The generated script of a model with sheets runs with values of the parameter
    that take their volume away and give it back: off, the force is that of the soft
    block alone; on, the sheets stiffen it."""
    text = codegen(model(sheets=1))
    assert "sheets = 1\n" in text
    alone = forces(run(model(metal=False)))
    on = forces(run(model(sheets=1), text))
    off = forces(run(model(sheets=1), text.replace("sheets = 1\n", "sheets = 0\n")))
    np.testing.assert_allclose(off, alone, rtol=1e-8, atol=1e-12)
    assert on[-1] > 1.5 * alone[-1]


def test_the_script_of_the_steps():
    """The items of the steps of a script with meshes of scripts are the solid bodies
    with a volume, and its steps hold the dual fields of the sections of the
    formulation u-p-J without volume; the steps of other scripts are as before."""
    text = codegen(model(kind="u-p-J mixed", steps=["metal"]))
    assert (
        "# with_volume() leaves out the solid bodies of sections without volume" in text
    )
    assert "    items=with_volume(solid_metal),\n" in text
    assert (
        "    boundaries={\n"
        "        **boundaries,\n"
        "        **hold_dual_fields(field, *fields_without_volume(solid_metal)),\n"
        "    },\n"
    ) in text
    # the static hold of a section that the step leaves out (#428) and the hold at
    # runtime
    document = model(kind="u-p-J mixed")
    sections = [c for c in document["commands"] if c["command"] == "section.add"]
    sections[0].update(formulation="u-p-J", bulk=5.0, material="rubber")
    step = next(c for c in document["commands"] if c["command"] == "step.add")
    step["sections"] = ["metal"]
    held = "**hold_dual_fields(field, field_soft, *fields_without_volume(solid_metal)),"
    assert f"        {held}\n" in codegen(document)
    # the forces of a point load are the forces of the solid bodies with a volume
    text = codegen(model(load=True))
    assert "    items=[*with_volume(solid_soft, solid_metal), force],\n" in text
    assert "boundary=force, items=with_volume(solid_soft, solid_metal)\n" in text
    # a model without meshes of scripts
    document = json.loads((GOLDEN / "bar_two_materials" / "commands.json").read_text())
    text = codegen(document)
    assert "with_volume" not in text and "items=[solid_" in text


def test_the_sandwich_spring_without_sheets(tmp_path, monkeypatch):
    """The example of #418 and #429: the sandwich spring of the samples with one soft
    layer and a parameter ``sheets``, without sheets one degenerate cell on a point of
    the soft layers. Its section is in the step and off: the force is that of the
    model without the sheets at all."""
    shutil.copytree(SANDWICH, tmp_path, dirs_exist_ok=True)
    with (tmp_path / "sandwich_spring.py").open("a", encoding="utf-8") as file:
        file.write(WITHOUT_SHEETS)
    monkeypatch.chdir(tmp_path)
    document = json.loads((tmp_path / "model.felupe.json").read_text("utf-8"))
    commands = document["commands"]
    for command in commands:
        if command["name"] == "layers":
            command["value"] = 1
    sheets = {"command": "parameter.add", "name": "sheets", "value": 0}
    commands.insert(1, {**sheets, "integer": True})
    metal = {"metal_mesh", "metal_cells", "steel", "steel_sheets"}
    without = {**document, "commands": [c for c in commands if c["name"] not in metal]}
    forces = [np.array(runner.run(d)["job"]["y"])[:, 0] for d in (document, without)]
    np.testing.assert_allclose(forces[0], forces[1], rtol=1e-8, atol=1e-12)
    assert forces[0][-1] == pytest.approx(1940.217, abs=1e-3)


def test_the_results_of_a_section_without_volume(folder):
    """The strains and the stresses of a section without volume are NaN: the ranges
    and the extremes skip them, and the exports (VTU and XDMF, of the cells and at
    the points) write them, so that the import of results (#414) reads them."""
    runner.run(model())
    last = results.substeps("job")
    for quantity in ("strain_max", "stress_min", "stress_mises"):
        for method in ("cells", "mean", "project"):
            meta = json.loads(results.scene("job", last, quantity, method)[0])
            assert meta["sections"]["metal"] == {"range": None, "extremes": None}
            assert meta["range"] == meta["sections"]["soft"]["range"]
            assert meta["extremes"]["max"]["section"] == "soft"
            ranges = json.loads(results.ranges("job", quantity, method))
            assert ranges["sections"]["metal"] == [None] * last
    for method in ("cells", "mean"):
        assert results.export("job", "vtu", method=method)
    data = results.export("job", "xdmf")
    file = resultfile.read("job.xdmf", data)
    assert file.description["sections"] == ["soft", "metal"]
    resultfile.load("job.xdmf", data)
    meta = json.loads(results.scene("job", last, "stress_max")[0])
    assert meta["sections"]["metal"] == {"range": None, "extremes": None}
    assert meta["sections"]["soft"]["range"] is not None
