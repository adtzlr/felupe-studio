"""Steps that leave out a section with mixed fields (#428): only the solid body of the
section has stiffness for its dual fields (the pressure and the volume ratio of
``u-p-J``), so a step without it holds them with ``hold_dual_fields()`` of the
script, at their values at the start of the step."""

import contextlib
import io

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio._helpers import Held, hold_dual_fields, mixed_field, mixed_region
from felupe_studio.codegen import codegen
from felupe_studio.commands import errors

TOL = 1e-10


@pytest.fixture
def meshes(tmp_path, monkeypatch):
    """A block of tetrahedrons at 0 <= x <= 1 and a block of hexahedrons at
    1 <= x <= 2, each 1 x 1 in y and z, as mesh files."""
    tets = fem.mesh.triangulate(fem.Cube(a=(0, 0, 0), b=(1, 1, 1), n=3))
    hexs = fem.Cube(a=(1, 0, 0), b=(2, 1, 1), n=3)
    meshio.Mesh(tets.points, [("tetra", tets.cells)]).write(tmp_path / "tets.vtu")
    meshio.Mesh(hexs.points, [("hexahedron", hexs.cells)]).write(tmp_path / "hexs.vtu")
    monkeypatch.chdir(tmp_path)


def model(*steps, jobs=None, tets=True):
    """The blocks of :func:`meshes`, the tetrahedrons ``u-p-J`` (MINI, mixed fields)
    and the hexahedrons ``u``, fixed at x = 0 and moved at x = 2 (``move``), with the
    boundary ``hold_tets`` of all points of the tetrahedrons. Without the
    tetrahedrons, the hexahedrons are fixed at x = 1."""
    if jobs is None:
        jobs = [("job", [s["name"] for s in steps])]
    commands = []
    if tets:
        commands += [
            {"command": "mesh.import", "name": "tet_mesh", "file": "tets.vtu"},
            {"command": "cellset.from_file", "name": "tet_cells", "mesh": "tet_mesh"},
        ]
    commands += [
        {"command": "mesh.import", "name": "hex_mesh", "file": "hexs.vtu"},
        {"command": "cellset.from_file", "name": "hex_cells", "mesh": "hex_mesh"},
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHooke",
            "parameters": {"mu": 1.0},
        },
        {
            "command": "material.add",
            "name": "foam",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1.0, "lmbda": 2.0},
        },
    ]
    if tets:
        commands.append(
            {
                "command": "section.add",
                "name": "tets",
                "cellset": "tet_cells",
                "material": "rubber",
                "formulation": "u-p-J",
                "bulk": 5.0,
            }
        )
    commands += [
        {
            "command": "section.add",
            "name": "hexs",
            "cellset": "hex_cells",
            "material": "foam",
            "formulation": "u",
        },
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0 if tets else 1},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 2},
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
    ]
    if tets:
        commands += [
            {
                "command": "pointset.add",
                "name": "tet_points",
                "select": {"section": "tets"},
            },
            {
                "command": "boundary.add",
                "name": "hold_tets",
                "pointset": "tet_points",
                "constrained": ["x", "y", "z"],
            },
        ]
    commands += steps
    for name, names in jobs:
        job = {"command": "job.add", "name": name, "steps": names, "curve": "move"}
        commands.append({**job, "tol": TOL})
    return {"schema_version": 3, "commands": commands}


def step(name, start=None, end=None, **fields):
    """A step that ramps ``move`` from start to end, if given."""
    command = {"command": "step.add", "name": name, **fields}
    if end is not None:
        ramped = [{"target": "move", "start": start, "end": end}]
        command["ramp"] = {"num": 2, "items": ramped}
    return command


def run(document):
    """The namespace of the script of a command list, after its jobs."""
    assert errors(document) == []
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(codegen(document), namespace)  # noqa: S102
    return namespace


def forces(namespace, name="job"):
    return np.array(namespace[name].y)[:, 0]


def test_the_script_of_a_step_without_a_section_with_mixed_fields(meshes):
    script = codegen(
        model(
            step("pull", 0, 0.3, sections=["hexs"]),
            step("release", sections=["hexs"], boundaries=["fixed", "hold_tets"]),
            step("both", 0, 0.3),
        )
    )
    held = "boundaries={**boundaries, **hold_dual_fields(field, field_tets)},"
    assert f"    {held}\n" in script
    assert (
        "    boundaries={\n"
        '        **pick(boundaries, ["fixed", "hold_tets"]),\n'
        "        **hold_dual_fields(field, field_tets),\n"
        "    },\n"
    ) in script
    assert (
        "both = fem.Step(\n"
        "    items=[solid_tets, solid_hexs],\n"
        '    ramp={boundaries["move"]: ramp_both},\n'
        "    boundaries=boundaries,\n"
    ) in script
    assert "class Held(fem.Boundary):" in script


def test_no_helpers_without_a_step_that_leaves_out_a_section(meshes):
    script = codegen(model(step("pull", 0, 0.3), step("off", sections=["tets"])))
    # a step without a section of the displacements only holds nothing
    assert "hold_dual_fields" not in script and "class Held" not in script


def test_a_step_without_a_section_with_mixed_fields(meshes):
    """The example of #428: the tetrahedrons are off, their points held. Without the
    hold of the dual fields, the first substep fails (NaN). The force is the one of
    the hexahedrons alone, fixed where they touch the tetrahedrons."""
    held = run(model(step("pull", 0, 0.3, sections=["hexs"])))
    alone = run(model(step("pull", 0, 0.3), tets=False))
    assert forces(held)[-1] > 0.1
    np.testing.assert_allclose(forces(held), forces(alone), rtol=1e-8, atol=1e-12)


def test_a_section_off_and_on_again(meshes):
    """A section that is off in the second step and on again in the third: its
    pressure and volume ratio stay those of the first step, and the curve is that
    of the first and the third step."""
    steps = [
        step("load", 0, 0.2, boundaries=["fixed", "move"]),
        step("off", sections=["hexs"], boundaries=["fixed", "move", "hold_tets"]),
        step("on", 0.2, 0.4, boundaries=["fixed", "move"]),
    ]
    first = run(model(*steps, jobs=[("job_1", ["load"])]))
    second = run(model(*steps, jobs=[("job_1", ["load"]), ("job_2", ["off"])]))
    for slot in (1, 2):
        loaded = first["field_tets"][slot].values
        assert np.ptp(loaded) > 0.01
        np.testing.assert_array_equal(second["field_tets"][slot].values, loaded)
    all_steps = run(model(*steps, jobs=[("job", ["load", "off", "on"])]))
    without = run(model(*steps, jobs=[("job", ["load", "on"])]))
    np.testing.assert_allclose(
        forces(all_steps)[-1], forces(without)[-1], rtol=1e-8, atol=1e-12
    )


@pytest.mark.parametrize("n, cell_type, held", [(2, "tetra", 2), (2, "hexahedron", 0)])
def test_the_boundaries_of_the_dual_fields(n, cell_type, held):
    """The dual fields of mixed fields after the merge, at their slots; a field
    container of the displacements only (linear hexahedrons) has none."""
    cube = fem.Cube(n=n)
    mesh = fem.mesh.triangulate(cube) if cell_type == "tetra" else cube
    other = fem.FieldsMixed(fem.RegionHexahedron(fem.Cube(a=(1, 0, 0), b=(2, 1, 1))))
    container = mixed_field(mixed_region(mesh))
    field = fem.field.merge([other, container])
    boundaries = hold_dual_fields(field, container)
    assert len(boundaries) == held
    assert list(boundaries) == [f"field[{k}]" for k in range(3, 3 + held)]
    for key, boundary in boundaries.items():
        assert boundary.field is field[int(key[6:-1])]
        assert boundary.dof.size == boundary.field.values.size


def test_a_held_field_is_held_at_its_values():
    """The value of a held field is the values of the field (a given value is
    ignored), so FElupe holds its degrees of freedom where they are."""
    region = fem.RegionHexahedron(fem.Cube(n=2))
    field = fem.FieldsMixed(region, n=3)
    held = Held(field[2])
    np.testing.assert_array_equal(held.value, np.ones(field[2].values.size))
    held.update(0.0)
    field[2].values = np.full_like(field[2].values, 1.5)
    np.testing.assert_array_equal(held.value, 1.5)
    dof0, _ = fem.dof.partition(field, {"held": held})
    ext0 = fem.dof.apply(field, {"held": held}, dof0)
    np.testing.assert_array_equal(ext0, 1.5)
