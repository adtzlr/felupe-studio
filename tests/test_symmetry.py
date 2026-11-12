"""Symmetry planes (#186): ``symmetry.add`` makes ``fem.dof.symmetry`` on the merged
field, a part of the boundaries of all steps like the boundaries of a load case."""

import runpy

import felupe as fem
import meshio
import numpy as np

from felupe_studio.codegen import codegen, object_lines
from felupe_studio.commands import errors, notes
from felupe_studio.loadcases import symmetry_call, symmetry_planes


def model(*extra):
    """A box 0 <= x, y, z <= 1, its left end fixed in x and pulled at the right."""
    return {
        "schema_version": 3,
        "commands": [
            {"command": "mesh.import", "name": "box", "file": "box.vtu"},
            {"command": "cellset.from_file", "name": "all", "mesh": "box"},
            {
                "command": "material.add",
                "name": "rubber",
                "model": "NeoHookeCompressible",
                "parameters": {"mu": 1.0, "lmbda": 2.0},
            },
            {
                "command": "section.add",
                "name": "body",
                "cellset": "all",
                "material": "rubber",
                "formulation": "u",
            },
            {
                "command": "pointset.add",
                "name": "right",
                "select": {"axis": "x", "value": 1},
            },
            {
                "command": "boundary.add",
                "name": "move",
                "pointset": "right",
                "constrained": ["x"],
            },
            *extra,
            {
                "command": "step.add",
                "name": "step_1",
                "ramp": {"num": 2, "items": [{"target": "move", "end": 0.2}]},
            },
            {
                "command": "job.add",
                "name": "job_1",
                "steps": ["step_1"],
                "curve": "move",
            },
        ],
    }


def test_call():
    assert symmetry_call({"axes": ["y"]}) == (
        "fem.dof.symmetry",
        ["field[0]", "axes=(False, True, False)", "y=0.0"],
    )
    # the planes in the order x, y, z; coordinates of other axes are ignored
    assert symmetry_call({"axes": ["z", "x"], "x": 1, "y": 5, "z": -2.5}) == (
        "fem.dof.symmetry",
        ["field[0]", "axes=(True, False, True)", "x=1.0", "z=-2.5"],
    )


def test_script():
    symmetry = {"command": "symmetry.add", "name": "half", "axes": ["x", "z"], "z": 0.5}
    document = model(symmetry)
    assert errors(document) == []
    script = codegen(document)
    assert (
        "# symmetry planes (fem.dof)\n"
        "half = fem.dof.symmetry(field[0], axes=(True, False, True), x=0.0, z=0.5)\n"
    ) in script
    assert '    **{f"half/{k}": v for k, v in half.items()},\n}' in script
    # the lines of the symmetry: its call and its entry of the boundaries
    lines = script.splitlines()
    ranges = object_lines(script, document)["half"]
    assert [lines[first - 1] for first, _ in ranges] == [
        "half = fem.dof.symmetry(field[0], axes=(True, False, True), x=0.0, z=0.5)",
        '    **{f"half/{k}": v for k, v in half.items()},',
    ]


def test_fixes_the_normal_components(tmp_path, monkeypatch):
    mesh = fem.Cube(n=3)
    meshio.Mesh(mesh.points, [(mesh.cell_type, mesh.cells)]).write(tmp_path / "box.vtu")
    symmetry = {"command": "symmetry.add", "name": "sym", "axes": ["x", "y", "z"]}
    script = tmp_path / "script.py"
    script.write_text(codegen(model(symmetry)), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    namespace = runpy.run_path(str(script))

    boundaries = namespace["boundaries"]
    assert set(boundaries) == {"move", "sym/symx", "sym/symy", "sym/symz"}
    # like fem.dof.symmetry of FElupe: the normal component on the points of every
    # plane (the merged field has the points in another order)
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    reference = fem.dof.symmetry(field[0])
    points = namespace["field"].region.mesh.points
    for k, key in enumerate(("symx", "symy", "symz")):
        boundary = boundaries[f"sym/{key}"]
        np.testing.assert_array_equal(np.unique(boundary.dof % 3), [k])
        np.testing.assert_allclose(
            np.sort(points[boundary.points], axis=0),
            np.sort(mesh.points[reference[key].points], axis=0),
            err_msg=key,
        )
    # the step has the symmetry planes; the box is pulled without rigid body motion
    job = namespace["job_1"]
    assert np.all(np.isfinite(job.y))
    assert np.array(job.y)[-1, 0] > 0


def test_planes_of_load_cases():
    assert symmetry_planes({"type": "uniaxial"}) == ["x", "y", "z"]
    assert symmetry_planes({"type": "planar", "symmetry": True}) == ["x", "y", "z"]
    assert symmetry_planes({"type": "biaxial", "symmetry": False}) == []
    assert symmetry_planes({"type": "shear", "axis": "z", "normal": "x"}) == ["y"]


def test_notes_about_repeated_planes():
    commands = [
        {"command": "symmetry.add", "name": "half", "axes": ["x", "y"], "y": 0.5},
        {"command": "loadcase.add", "name": "test", "type": "shear"},
        {"command": "symmetry.add", "name": "quarter", "axes": ["y", "z"], "y": 0.5},
    ]
    # the load case may come later: its plane z = 0 is still repeated
    assert notes(commands) == [
        "commands/2: the plane y = 0.5 of symmetry 'quarter' is already a symmetry "
        "plane of symmetry 'half'.",
        "commands/2: the plane z = 0 of symmetry 'quarter' is already a symmetry "
        "plane of load case 'test'.",
    ]
    assert notes(commands[:2]) == []


def test_symmetry_is_no_boundary_of_a_ramp_or_curve():
    symmetry = {"command": "symmetry.add", "name": "half", "axes": ["y"]}
    document = model(symmetry)
    document["commands"][-1]["curve"] = "half"
    assert errors(document) == [
        "commands/8: 'half' in 'curve' of 'job_1' is a symmetry, not a boundary or "
        "load."
    ]
