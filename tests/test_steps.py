"""Steps that switch boundaries on and off (#393): ``step.add`` with ``boundaries``
has only these boundaries, load cases and symmetry planes, and the plugin
``BoundarySwitch`` of the script sets the values of the boundaries that a step
switches on, at the start of the step or of the job (``switched_on``)."""

import contextlib
import io

import felupe as fem
import numpy as np
import pytest

from felupe_studio._helpers import BoundarySwitch, pick
from felupe_studio.codegen import codegen, object_lines
from felupe_studio.commands import errors, notes

# a tight tolerance, to compare the script with FElupe called directly
TOL = 1e-10

# the total force of the point load at the right end: its force at each of its
# 3 x 3 points
PUSH = 0.2


def bar(*steps, jobs=None, push=False):
    """A bar 3 x 1 x 1 made by a tool, fixed at x = 0, with the boundary move in x
    and optionally the point load push at x = 3, the steps and the jobs (by default
    one job of the steps with the curve of move)."""
    if jobs is None:
        jobs = [job("job_1", [s["name"] for s in steps])]
    load = {
        "command": "load.add",
        "name": "push",
        "points": "right",
        "force": [PUSH / 9, 0, 0],
    }
    return {
        "schema_version": 3,
        "commands": [
            {
                "command": "mesh.generate",
                "name": "bar",
                "tool": "Cube",
                "parameters": {"a": [0, 0, 0], "b": [3, 1, 1], "n": [7, 3, 3]},
            },
            {"command": "cellset.from_file", "name": "all_cells", "mesh": "bar"},
            {
                "command": "material.add",
                "name": "rubber",
                "model": "NeoHookeCompressible",
                "parameters": {"mu": 1.0, "lmbda": 2.0},
            },
            {
                "command": "section.add",
                "name": "body",
                "cellset": "all_cells",
                "material": "rubber",
                "formulation": "u",
            },
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
            *([load] if push else []),
            *steps,
            *jobs,
        ],
    }


def job(name, steps, curve="move"):
    return {
        "command": "job.add",
        "name": name,
        "steps": steps,
        "curve": curve,
        "tol": TOL,
    }


def step(name, *items, num=2, **fields):
    """A step that ramps items ``(target, start, end)``."""
    command = {"command": "step.add", "name": name, **fields}
    if items:
        ramped = [{"target": t, "start": s, "end": e} for t, s, e in items]
        command["ramp"] = {"num": num, "items": ramped}
    return command


def run(document):
    """The namespace of the script of a command list, after its jobs."""
    assert errors(document) == []
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(codegen(document), namespace)  # noqa: S102
    return namespace


def curve(namespace, name="job_1"):
    """The displacements and the forces of the curve of a job, in x."""
    job = namespace[name]
    return np.array(job.x)[:, 0], np.array(job.y)[:, 0]


class Bar:
    """The bar of :func:`bar`, made with FElupe directly."""

    def __init__(self, push=False):
        mesh = fem.Cube(a=(0, 0, 0), b=(3, 1, 1), n=(7, 3, 3))
        region = fem.RegionHexahedron(mesh)
        self.field = fem.FieldContainer([fem.Field(region, dim=3)])
        umat = fem.NeoHookeCompressible(mu=1.0, lmbda=2.0)
        self.items = [fem.SolidBody(umat, self.field)]
        right = np.where(np.isclose(mesh.points[:, 0], 3))[0]
        self.push = fem.PointLoad(self.field, right, values=[PUSH / 9, 0, 0])
        if push:
            self.items.append(self.push)
        self.fixed = fem.Boundary(self.field[0], fx=0)
        self.move = fem.Boundary(self.field[0], fx=3, skip=(0, 1, 1))

    def step(self, ramp=None, move=True):
        boundaries = {"fixed": self.fixed}
        if move:
            boundaries["move"] = self.move
        return fem.Step(self.items, ramp=ramp, boundaries=boundaries)

    @staticmethod
    def scaled(start, end):
        """The ramp of the force of the point load, scaled from start to end."""
        return np.outer(ramp(start, end), [PUSH / 9, 0, 0])

    def evaluate(self, *steps):
        job = fem.CharacteristicCurve(steps=list(steps), boundary=self.move)
        with contextlib.redirect_stdout(io.StringIO()):
            job.evaluate(x0=self.field, tol=TOL)
        return np.array(job.x)[:, 0], np.array(job.y)[:, 0]

    def displacements(self):
        return self.field[0].values.ravel()[self.move.dof].copy()


def ramp(start, end, num=2):
    return fem.math.linsteps([start, end], num=num)


def test_the_script_of_steps_that_switch_boundaries():
    document = bar(
        step("pull", ("move", 0, 0.5)),
        step("release", boundaries=["fixed"]),
        step("clamp", switched_on="job"),
        jobs=[{**job("job_1", ["pull", "release", "clamp"]), "cutback": {}}],
    )
    script = codegen(document)
    # the boundaries of a step, all of them by default
    assert "    boundaries=boundaries,\n)\nrelease" in script
    assert '    boundaries=pick(boundaries, ["fixed"]),\n' in script
    # one plugin of all jobs, before a cutback, which subdivides with its values
    assert "boundary_switch = BoundarySwitch(job_start=[clamp])\n" in script
    assert "    plugins=[boundary_switch, fem.CutbackPlugin()],\n" in script
    assert "class BoundarySwitch(fem.Plugin):" in script
    # the lines of a step with its boundaries belong to the step
    lines = object_lines(script, document)
    numbers = [i for i, line in enumerate(script.splitlines(), 1) if "=pick(" in line]
    assert any(first <= numbers[0] <= last for first, last in lines["release"])


def test_no_plugin_without_steps_that_switch_boundaries():
    script = codegen(bar(step("pull", ("move", 0, 0.5))))
    assert "BoundarySwitch" not in script and "pick(" not in script
    assert "plugins=" not in script


def test_pick_the_boundaries_of_a_load_case_and_a_symmetry_plane():
    boundaries = {
        "fixed": 1,
        "tension/move": 2,
        "tension/symx": 3,
        "half/symz": 4,
        "tensions": 5,
    }
    assert pick(boundaries, ["tension", "half"]) == {
        "tension/move": 2,
        "tension/symx": 3,
        "half/symz": 4,
    }


def test_a_released_boundary_springs_back():
    # pulled by a boundary in the first step, free in the second: the free end
    # springs back, and the force of the boundary is zero
    namespace = run(
        bar(step("pull", ("move", 0, 0.5)), step("release", boundaries=["fixed"]))
    )
    x, y = curve(namespace)
    direct = Bar()
    pull = direct.step(ramp={direct.move: ramp(0, 0.5)})
    expected = direct.evaluate(pull, direct.step(move=False))
    np.testing.assert_allclose(x, expected[0], atol=1e-10)
    np.testing.assert_allclose(y, expected[1], rtol=1e-6, atol=1e-10)
    assert y[2] > 0.1
    assert x[-1] == pytest.approx(0, abs=1e-8) and y[-1] == pytest.approx(0, abs=1e-8)
    assert np.abs(namespace["field"][0].values).max() < 1e-8


def pushed(*clamp_items, **clamp):
    """A bar pushed by the load with the boundary move off, then clamped while the
    load is removed (and move ramped)."""
    return bar(
        step("load", ("push", 0, 1), boundaries=["fixed"]),
        step("clamp", ("push", 1, 0), *clamp_items, **clamp),
        push=True,
    )


def pushed_directly():
    """The bar of :func:`pushed` with FElupe directly, after the load."""
    direct = Bar(push=True)
    direct.evaluate(direct.step(ramp={direct.push: direct.scaled(0, 1)}, move=False))
    return direct


def test_a_boundary_switched_on_holds_its_points():
    # at the start of the step (the default): the points stay where they are, and
    # the reaction force is the former load
    x, y = curve(run(pushed()))
    direct = pushed_directly()
    direct.move.update(direct.displacements())
    expected = direct.evaluate(direct.step(ramp={direct.push: direct.scaled(1, 0)}))
    np.testing.assert_allclose(x[3:], expected[0], rtol=1e-8)
    np.testing.assert_allclose(y[3:], expected[1], rtol=1e-6, atol=1e-10)
    assert x[2] > 0.1
    np.testing.assert_allclose(x[3:], x[2], rtol=1e-10)
    np.testing.assert_allclose(y[3:], [0, PUSH / 2, PUSH], rtol=1e-6, atol=1e-8)


def test_a_boundary_switched_on_at_the_start_of_the_job():
    # the points move back to where they were at the start of the job, the
    # undeformed bar of the first job: the boundary holds them against the load
    x, y = curve(run(pushed(switched_on="job")))
    assert x[2] > 0.1
    np.testing.assert_allclose(x[3:], 0, atol=1e-10)
    np.testing.assert_allclose(y[3:], [-PUSH, -PUSH / 2, 0], rtol=1e-6, atol=1e-8)


@pytest.mark.parametrize("switched_on", ["step", "job"])
def test_a_ramp_of_a_switched_on_boundary_is_relative(switched_on):
    # the ramp moves the points by its values from where they were at the start of
    # the step or of the job
    held = curve(run(pushed(switched_on=switched_on)))[0]
    x, y = curve(run(pushed(("move", 0.1, 0.3), switched_on=switched_on)))
    np.testing.assert_allclose(x[3:], held[3:] + [0.1, 0.2, 0.3], atol=1e-10)
    # FElupe called directly: a ramp of absolute values, from the displacements of
    # the points at the start of the step, or from the undeformed bar at the start of
    # the first job
    direct = pushed_directly()
    start = direct.displacements() if switched_on == "step" else 0
    absolute = start + ramp(0.1, 0.3)[:, None]
    ramped = {direct.push: direct.scaled(1, 0), direct.move: absolute}
    expected = direct.evaluate(direct.step(ramp=ramped))
    np.testing.assert_allclose(x[3:], expected[0], atol=1e-10)
    np.testing.assert_allclose(y[3:], expected[1], rtol=1e-6, atol=1e-10)


def test_the_values_at_the_start_of_a_later_job():
    # the second job starts with move on (pulled to 0.5): after a release, move is
    # switched on with its values at the start of the job, which pull the free end
    # back to 0.5; at the start of the step, it would hold the released end
    def jobs(switched_on):
        return bar(
            step("pull", ("move", 0, 0.5)),
            step("release", boundaries=["fixed"]),
            step("back", switched_on=switched_on),
            jobs=[job("job_1", ["pull"]), job("job_2", ["release", "back"])],
        )

    x, y = curve(run(jobs("job")), "job_2")
    assert x[0] == pytest.approx(0, abs=1e-8) and y[0] == pytest.approx(0, abs=1e-8)
    assert x[1] == pytest.approx(0.5) and y[1] > 0.1
    pulled = curve(run(jobs("job")), "job_1")
    assert y[1] == pytest.approx(pulled[1][-1], rel=1e-6)
    x, y = curve(run(jobs("step")), "job_2")
    np.testing.assert_allclose(x, 0, atol=1e-8)
    np.testing.assert_allclose(y, 0, atol=1e-8)


def test_a_repeated_step_switches_on_again():
    # a step that comes again in a job (#331) switches on what the step before it
    # does not have
    x, y = curve(
        run(
            bar(
                step("load", ("push", 0, 1), boundaries=["fixed"]),
                step("clamp", ("push", 1, 0)),
                jobs=[job("job_1", ["load", "clamp", "load", "clamp"])],
                push=True,
            )
        )
    )
    # released without the load, the end springs back, and the load pushes it again
    assert x[2] > 0.1
    np.testing.assert_allclose(x[3:6], x[2], rtol=1e-10)
    assert x[6] == pytest.approx(0, abs=1e-8)
    assert x[8] == pytest.approx(x[2], rel=1e-8)
    np.testing.assert_allclose(x[9:], x[8], rtol=1e-10)


def test_a_symmetry_plane_switched_off():
    # the symmetry plane z = 0 holds the bottom of the bar in z; off, a load in z
    # bends the bar
    document = bar(step("load", ("push", 0, 1)), push=True)
    commands = document["commands"]
    commands.insert(8, {"command": "symmetry.add", "name": "half", "axes": ["z"]})
    commands[9]["force"] = [0, 0, PUSH / 9]
    namespace = run(document)
    bottom = np.isclose(namespace["points"][:, 2], 0)
    on = namespace["field"][0].values[:, 2]
    commands[10]["boundaries"] = ["fixed", "move"]
    off = run(document)["field"][0].values[:, 2]
    np.testing.assert_allclose(on[bottom], 0, atol=1e-12)
    assert off[bottom].max() > 0.01


def test_the_notes_of_a_curve_that_is_off():
    document = bar(
        step("pull", ("move", 0, 0.5)),
        step("release", boundaries=["fixed"]),
    )
    assert notes(document["commands"]) == [
        "commands/10: job 'job_1' records the curve of 'move', which is off in "
        "step 'release': its force is zero there."
    ]


def test_the_values_of_the_prescribed_degrees_of_freedom():
    direct = Bar()
    dof = direct.move.dof.size
    np.testing.assert_array_equal(BoundarySwitch.prescribed(direct.move, 0.5), 0.5)
    assert BoundarySwitch.prescribed(direct.move, 0.5).shape == (dof,)
    values = np.arange(dof, dtype=float)
    np.testing.assert_array_equal(
        BoundarySwitch.prescribed(direct.move, values), values
    )
    # one value per prescribed component of its points
    np.testing.assert_array_equal(
        BoundarySwitch.prescribed(direct.fixed, [1, 2, 3]),
        np.tile([1.0, 2, 3], direct.fixed.points.size),
    )


@pytest.mark.parametrize("switched_on", ["step", "job"])
def test_a_cutback_of_the_ramp_of_a_switched_on_boundary(switched_on):
    # the plugin sets the values of the substep before the cutback stores them, so a
    # subdivided substep ends at the same values
    document = pushed(("move", 0.1, 1.5), switched_on=switched_on)
    expected = curve(run(document))
    document["commands"][-1].update(cutback={"factor": 0.5}, maxiter=3)
    namespace = run(document)
    [cutback] = [
        p
        for p in namespace["job_1"].dispatcher.plugins
        if isinstance(p, fem.CutbackPlugin)
    ]
    assert sum(cutback.cutbacks[3:]) > 0
    x, y = curve(namespace)
    np.testing.assert_allclose(x, expected[0], atol=1e-10)
    np.testing.assert_allclose(y, expected[1], atol=1e-8)
