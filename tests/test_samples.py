"""The sample models of the app (app/public/samples, made by
app/scripts/make_samples.py) are valid project files and solve with FElupe."""

import json
import sys
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio.commands import errors
from felupe_studio.project import dumps, loads
from felupe_studio.runner import run

APP = Path(__file__).parents[1] / "app"
SAMPLES = json.loads((APP / "src" / "core" / "samples.json").read_text())
sys.path.insert(0, str(APP / "scripts"))

from make_samples import thumbnail  # noqa: E402


def test_index_lists_every_sample():
    folders = {p.name for p in (APP / "public" / "samples").iterdir() if p.is_dir()}
    assert {s["id"] for s in SAMPLES} == folders
    for sample in SAMPLES:
        assert sample["title"] and sample["description"] and sample["topics"]


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_sample_solves(sample, monkeypatch):
    folder = APP / "public" / "samples" / sample["id"]
    text = (folder / "model.felupe.json").read_text(encoding="utf-8")
    document = loads(text)
    # a canonical project file, as the app saves it
    assert dumps(document) == text
    assert errors(document) == []
    # the files of imported meshes and of scripts that make meshes (#182)
    files = {
        c["file"]
        for c in document["commands"]
        if c["command"] in ("mesh.import", "mesh.script")
    }
    assert sorted(files) == sample["files"]
    assert all((folder / name).is_file() for name in files)

    monkeypatch.chdir(folder)
    results = run(document)
    # every job (the engine mount has two, #241): the substeps of its steps and a
    # force (the metacone is pushed in -x)
    steps = {c["name"]: c for c in document["commands"] if c["command"] == "step.add"}
    for job in (c for c in document["commands"] if c["command"] == "job.add"):
        result = results[job["name"]]
        num = sum(steps[name]["ramp"]["num"] + 1 for name in job["steps"])
        assert result["substeps"] == num
        force = np.array(result["y"])
        assert np.all(np.isfinite(force)) and np.abs(force[-1]).max() > 0


def test_material_test_is_analytical(monkeypatch):
    "Uniaxial tension of the incompressible Neo-Hooke model: P = mu (λ - 1 / λ²)."
    folder = APP / "public" / "samples" / "material-test"
    monkeypatch.chdir(folder)
    results = run(loads((folder / "model.felupe.json").read_text()))["job"]
    stretch = 1 + np.array(results["x"])[:, 0]
    force = np.array(results["y"])[:, 0]
    # an eighth of a unit cube: the force is the nominal stress of the end face
    np.testing.assert_allclose(force, 0.5 * (stretch - 1 / stretch**2), rtol=2e-3)


def test_glued_plate_moves_and_tilts(monkeypatch):
    "The plate of the glued plate is moved by 8 mm and tilted by 0.1 rad (#102)."
    from felupe_studio import results

    folder = APP / "public" / "samples" / "glued-plate"
    monkeypatch.chdir(folder)
    run(loads((folder / "model.felupe.json").read_text()))
    meta, _ = results.scene("job", results.substeps("job"), "displacement")
    points = {p["name"]: p for p in json.loads(meta)["points"]}
    np.testing.assert_allclose(points["plate"]["displacement"], [8, 0, 0], atol=1e-8)
    np.testing.assert_allclose(points["tilt"]["displacement"], [0, 0.1, 0], atol=1e-8)
    assert points["tilt"]["rotation"]
    # the shear force and the moment that tilts the plate
    assert points["plate"]["force"][0] > 0
    assert abs(points["tilt"]["force"][1]) > 0


def test_sandwich_spring_follows_its_parameters(monkeypatch):
    """The sandwich spring (#184) with 3 and 5 soft layers: the same project with
    another value of a parameter. The top follows the height of the stack (z ==
    max), and the shear stiffness is about G A / (layers height)."""
    folder = APP / "public" / "samples" / "sandwich-spring"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    monkeypatch.chdir(folder)
    forces = {}
    for layers in (3, 5):
        for c in document["commands"]:
            if c["name"] == "layers":
                c["value"] = layers
        results = run(document)["job"]
        forces[layers] = np.array(results["y"])[-1, 0]
        assert np.array(results["x"])[-1, 0] == pytest.approx(12)
    # linear: 0.5 MPa * pi * 50² mm² / (layers * 8 mm) * 12 mm
    for layers, force in forces.items():
        linear = 0.5 * np.pi * 50**2 / (layers * 8) * 12
        assert force == pytest.approx(linear, rel=0.05)
    assert forces[3] / forces[5] == pytest.approx(5 / 3, rel=0.02)


def test_sandwich_spring_compressed_by_guide_z(monkeypatch):
    """The top sheet of the sandwich spring is guided in y and z by two boundaries,
    so a ramp of guide_z compresses the spring while it is sheared."""
    folder = APP / "public" / "samples" / "sandwich-spring"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    for c in document["commands"]:
        if c["command"] == "step.add":
            c["ramp"] = {
                "num": 2,
                "items": [
                    {"target": "shear", "end": 2},
                    {"target": "guide_z", "end": -1},
                ],
            }
        if c["command"] == "job.add":
            c["curve"] = "guide_z"
    monkeypatch.chdir(folder)
    results = run(document)["job"]
    assert np.array(results["x"])[-1, 2] == pytest.approx(-1)
    # the force of the compression
    assert np.array(results["y"])[-1, 2] < 0


@pytest.mark.parametrize(
    "sample, script",
    [
        ("sandwich-spring", "sandwich_spring.py"),
        ("sandwich-spring-axisymmetric", "sandwich_spring_2d.py"),
    ],
)
def test_sandwich_springs_have_cells_through_the_soft_layers(sample, script):
    """The parameter cells_height of the sandwich springs is the number of cells
    through a soft layer; a sheet keeps one cell through its thickness."""
    import runpy

    folder = APP / "public" / "samples" / sample
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    names = [c["name"] for c in document["commands"] if c["command"] == "parameter.add"]
    assert "cells_height" in names
    counts = {}
    for n in (1, 3):
        meshes = runpy.run_path(
            str(folder / script), init_globals={"cells_height": n, "layers": 2}
        )["mesh"]
        counts[n] = (len(meshes["soft"].cells), len(meshes["metal"].cells))
    assert counts[3][0] == 3 * counts[1][0]
    assert counts[3][1] == counts[1][1]


def test_axisymmetric_sandwich_spring_follows_its_parameters(monkeypatch):
    """The axisymmetric sandwich spring (#175) with 3 and 5 soft layers, pressed by
    0.04 mm: the first sheet follows the stack (x == min), the stiffness of the
    stack of bonded layers is inversely proportional to the number of layers."""
    folder = APP / "public" / "samples" / "sandwich-spring-axisymmetric"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    monkeypatch.chdir(folder)
    forces = {}
    for c in document["commands"]:
        if c["command"] == "step.add":
            c["ramp"] = {"num": 1, "items": [{"target": "press", "end": 0.04}]}
    for layers in (3, 5):
        for c in document["commands"]:
            if c["name"] == "layers":
                c["value"] = layers
        results = run(document)["job"]
        forces[layers] = np.array(results["y"])[-1, 0]
        assert np.array(results["x"])[-1, 0] == pytest.approx(0.04)
    assert forces[3] / forces[5] == pytest.approx(5 / 3, rel=0.02)


def test_plate_with_hole_concentrates_the_stress(monkeypatch):
    """The plate with a hole in plane strain (#175): the largest principal stress is
    at the top of the hole (x = 0, y = radius), more than twice the mean stress of
    the end (the force per unit thickness over the width) in the cell there."""
    from felupe_studio import results

    folder = APP / "public" / "samples" / "plate-with-hole"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    for c in document["commands"]:
        if c["command"] == "step.add":
            c["ramp"] = {"num": 1, "items": [{"target": "pull", "end": 0.4}]}
    monkeypatch.chdir(folder)
    force = np.array(run(document)["job"]["y"])[-1, 0]
    meta, _ = results.scene("job", 2, "stress_max")
    # the center of the cell at the top of the hole
    top = json.loads(meta)["extremes"]["max"]
    assert top["position"][0] == pytest.approx(0, abs=1)
    assert top["position"][1] == pytest.approx(10, abs=2)
    assert top["value"] / (force / 40) > 2


def test_plastic_plate_unloads_elastically(monkeypatch):
    """The elastic-plastic plate with a hole (#269): the first substep is elastic,
    with the stiffness of the same plate of the linear elastic material of small
    strains (#259); the unloading has the same stiffness and crosses zero force at a
    remaining elongation; the equivalent plastic strain is largest at the top of the
    hole (x = 0, y = radius)."""
    from felupe_studio import results

    folder = APP / "public" / "samples" / "plastic-plate"
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    monkeypatch.chdir(folder)
    result = run(document)["job"]
    u, force = np.array(result["x"])[:, 0], np.array(result["y"])[:, 0]
    meta, _ = results.scene("job", results.substeps("job"), "plastic_strain")
    extremes = json.loads(meta)["extremes"]
    # projected to the points, it is clipped at zero (#274)
    meta, _ = results.scene("job", results.substeps("job"), "plastic_strain", "project")
    projected = json.loads(meta)["extremes"]

    for c in document["commands"]:
        if c["command"] == "material.add":
            c["model"] = "LinearElasticSmallStrain"
            c["parameters"] = {"E": 210000, "nu": 0.3}
    elastic = run(document)["job"]
    stiffness = np.array(elastic["y"])[1, 0] / np.array(elastic["x"])[1, 0]

    assert force[1] / u[1] == pytest.approx(stiffness, rel=1e-8)
    # the curve bends over: yielding at the hole, then across the net section
    assert force[10] < 0.5 * stiffness * u[10]
    # unloading (the substeps of the second step, from its start)
    unloading = slice(11, None)
    slope = np.diff(force[unloading]) / np.diff(u[unloading])
    assert slope[0] == pytest.approx(stiffness, rel=0.01)
    remaining = np.interp(0, force[unloading][::-1], u[unloading][::-1])
    assert 0.04 < remaining < 0.07
    # yields again in compression before the end: softer than at the start
    assert slope[-1] < 0.5 * stiffness
    assert extremes["min"]["value"] == 0  # elastic far from the hole
    assert projected["min"]["value"] == 0
    assert projected["max"]["value"] > extremes["max"]["value"]
    top = extremes["max"]
    assert top["value"] > 0.005
    assert top["position"][0] == pytest.approx(0, abs=2)
    assert top["position"][1] == pytest.approx(10, abs=2)


def test_bushing_matches_ex05(monkeypatch):
    """The bushing (#185) with a rigid connection of the inner sleeve, compared with
    the example ex05 of FElupe on the same mesh, which prescribes the rotated
    positions of the inner sleeve: the moments of the torsion and the tilt."""
    import runpy

    import felupe as fem

    folder = APP / "public" / "samples" / "bushing"
    monkeypatch.chdir(folder)
    results = run(loads((folder / "model.felupe.json").read_text(encoding="utf-8")))
    torsion, tilt = np.array(results["job"]["y"])[-1, :2]

    # ex05, with the mesh of the script and as many substeps
    meshes = runpy.run_path("bushing.py")["mesh"]
    regions = [fem.RegionHexahedron(meshes[m]) for m in ("soft", "metal")]
    fields = [fem.Field(r, dim=3).as_container() for r in regions]
    field = fem.FieldContainer(fields).merge()
    solids = [
        fem.SolidBodyNearlyIncompressible(fem.NeoHooke(mu=1), fields[0], bulk=5000),
        fem.SolidBody(fem.LinearElasticLargeStrain(E=2.1e5, nu=0.3), fields[1]),
    ]
    x, y, z = field.region.mesh.points.T
    boundaries = fem.BoundaryDict(
        inner=fem.Boundary(field[0], mask=np.isclose(np.hypot(y, z), 25)),
        outer=fem.Boundary(field[0], mask=np.isclose(np.hypot(y, z), 65)),
    )
    inner = field.region.mesh.points[boundaries["inner"].points]
    move = []
    for progress in fem.math.linsteps([0, 1], num=6):
        rotated = fem.math.rotate_points(inner, 30 * progress, axis=0)
        rotated = fem.math.rotate_points(rotated, -5 * progress, axis=1)
        move.append([0, 0, 8 * progress] + rotated - inner)
    step = fem.Step(solids, ramp={boundaries["inner"]: move}, boundaries=boundaries)
    fem.Job([step]).evaluate(x0=field, tol=0.01, verbose=0)
    forces = sum(s.assemble.vector() for s in solids).toarray().reshape(-1, 3)
    points = boundaries["inner"].points
    deformed = inner + field[0].values[points]
    moment = np.cross(deformed - [0, 0, 8], forces[points]).sum(axis=0)

    # the same torsion; the tilt differs by the order of the two rotations of ex05
    assert torsion == pytest.approx(moment[0], rel=0.002)
    assert tilt == pytest.approx(moment[1], rel=0.01)


def test_hyperelastic_spring_matches_ex06(monkeypatch):
    """The hyperelastic spring with end stops (#222), compared with the example ex06
    of FElupe on the same mesh: the forces of the lower plate (the bonded face and
    the contact of the end stop) in z and x."""
    import felupe as fem

    folder = APP / "public" / "samples" / "hyperelastic-spring"
    monkeypatch.chdir(folder)
    results = run(loads((folder / "model.felupe.json").read_text(encoding="utf-8")))
    x, y = np.array(results["job"]["x"]), np.array(results["job"]["y"])

    # ex06, with as many substeps and the same tolerance
    mesh = fem.mesh.read("spring.vtu")[0]
    mesh.add_points([[0, 0, mesh.z.min()], [0, 0, mesh.z.max() + 0.1]])
    region = fem.RegionHexahedron(mesh)
    field = fem.FieldContainer([fem.Field(region, dim=3)])
    boundaries = fem.dof.symmetry(field[0], axes=(0, 1, 0))
    boundaries["fixed-contact"] = fem.Boundary(field[0], fz=mesh.z.max())
    boundaries["fixed"] = fem.Boundary(field[0], fz=mesh.z.max() - 0.1)
    boundaries["move-x"] = fem.Boundary(field[0], fz=mesh.z.min(), skip=(0, 1, 1))
    boundaries["move-y"] = fem.Boundary(field[0], fz=mesh.z.min(), skip=(1, 0, 1))
    boundaries["move-z"] = fem.Boundary(field[0], fz=mesh.z.min(), skip=(1, 1, 0))
    solid = fem.SolidBody(fem.NeoHookeCompressible(mu=1, lmbda=5), field)
    surface = np.unique(fem.RegionHexahedronBoundary(mesh).mesh_faces().cells)
    points = np.isin(np.arange(mesh.npoints), surface)
    stops = [
        fem.ContactRigidPlane(
            field,
            points=points,
            centerpoint=center,
            normal=normal,
            friction=0.5,
            items=[solid],
        )
        for center, normal in [(-2, [0, 0, 1]), (-1, [0, 0, -1])]
    ]
    table = fem.math.linsteps([0, 1], num=4)
    steps = [
        fem.Step(
            items=[solid, *stops],
            ramp={boundaries[move]: 40 * table},
            boundaries=boundaries,
        )
        for move in ["move-z", "move-x"]
    ]
    job = fem.CharacteristicCurve(steps=steps, boundary=boundaries["move-z"])
    job.evaluate(tol=0.01)
    np.testing.assert_allclose(x, np.array(job.x), atol=1e-8)
    # the forces of up to 18 kN, 1 N for the zeros of the lateral force
    np.testing.assert_allclose(
        y[:, [0, 2]], np.array(job.y)[:, [0, 2]], rtol=1e-3, atol=1
    )
    # the end stops stiffen the spring
    assert y[4, 2] / y[2, 2] > 2.5


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_thumbnail_is_up_to_date(sample):
    "The picture of a sample (#127) is made from its project by make_samples.py."
    folder = APP / "public" / "samples" / sample["id"]
    svg = (folder / "thumbnail.svg").read_text(encoding="utf-8")
    assert svg == thumbnail(folder), "Run python app/scripts/make_samples.py."
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"')
    assert svg.count("<polygon") > 10


def ex15():
    """The axisymmetric metacone of the example ex15 of FElupe: its force over the
    displacement of the end of its inner sleeve (with FElupe's tolerance)."""
    layers = [2, 11, 2, 11, 2]
    lines = [
        fem.mesh.Line(a=0, b=13, n=21).expand(n=1).translate(2, axis=1),
        fem.mesh.Line(a=0, b=13, n=21).expand(n=1).translate(2.5, axis=1),
        fem.mesh.Line(a=-0.2, b=10, n=21).expand(n=1).translate(4.5, axis=1),
        fem.mesh.Line(a=-0.2, b=10, n=21).expand(n=1).translate(5, axis=1),
        fem.mesh.Line(a=-0.4, b=7, n=21).expand(n=1).translate(6.5, axis=1),
        fem.mesh.Line(a=-0.4, b=7, n=21).expand(n=1).translate(7, axis=1),
    ]
    faces = fem.MeshContainer(
        [
            first.fill_between(second, n=n)
            for first, second, n in zip(lines[:-1], lines[1:], layers, strict=True)
        ]
    )

    def point(m):
        return m.points[np.unique(m.cells)].mean(axis=0) - np.array([2, 0])

    def mask(m):
        return np.unique(m.cells)

    kwargs = dict(axis=1, exponent=2.5, normalize=True)
    faces.points[:] = (
        faces[1]
        .add_runouts([3], centerpoint=point(faces[1]), mask=mask(faces[1]), **kwargs)
        .points
    )
    faces.points[:] = (
        faces[3]
        .add_runouts([7], centerpoint=point(faces[3]), mask=mask(faces[3]), **kwargs)
        .points
    )
    faces.points[:21] = faces.points[21 : 2 * 21]
    faces.points[-21:] = faces.points[-2 * 21 : -21]
    faces.points[:] = faces[0].rotate(15, axis=2).points
    faces[0].y[:21] = 2
    faces[-1].y[-21:] = 8.5
    mesh = fem.MeshContainer(
        [faces.stack([1, 3]), faces.stack([0, 2, 4])], merge=True, decimals=4
    )
    fields = [
        fem.FieldAxisymmetric(fem.RegionQuad(m), dim=2).as_container() for m in mesh
    ]
    x0 = fem.FieldContainer(fields).merge()
    rubber = fem.NeoHooke(mu=1)
    metal = fem.LinearElasticLargeStrain(E=2.1e5, nu=0.3)
    solid1 = fem.SolidBodyNearlyIncompressible(rubber, fields[0], bulk=5000)
    solid2 = fem.SolidBody(metal, fields[1])
    boundaries = fem.dof.uniaxial(x0, clamped=True, sym=False)
    ramp = {boundaries["move"]: fem.math.linsteps([0, 1], num=5) * -1.5}
    step = fem.Step(items=[solid1, solid2], ramp=ramp, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])
    job.evaluate(verbose=0)
    return mesh, np.array(job.x)[:, 0], np.array(job.y)[:, 0]


def test_metacone_like_ex15(monkeypatch):
    # the mesh of the script and the force of the sample (with FElupe's tolerance)
    # are those of the example ex15 of FElupe (#241)
    folder = APP / "public" / "samples" / "metacone"
    mesh, x, y = ex15()
    namespace = {}
    exec((folder / "metacone.py").read_text(encoding="utf-8"), namespace)
    for item, expected in zip(["rubber", "metal"], mesh, strict=True):
        made = namespace["mesh"][item]
        np.testing.assert_allclose(made.points, expected.points)
        np.testing.assert_array_equal(made.cells, expected.cells)

    monkeypatch.chdir(folder)
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    for cmd in document["commands"]:
        if cmd["command"] == "job.add":
            cmd["tol"] = 1.49e-8
    results = run(document)["job"]
    np.testing.assert_allclose(np.array(results["x"])[:, 0], x)
    np.testing.assert_allclose(np.array(results["y"])[:, 0], y, rtol=1e-8)
    assert y[-1] == pytest.approx(-516.77, rel=1e-4)


def ex07():
    """The vertical force of the engine mount of the example ex07 of FElupe over the
    vertical displacement of its inner metal part (with FElupe's tolerance)."""
    folder = APP / "scripts" / "ex07"
    meshes = fem.MeshContainer(
        [
            fem.mesh.read(folder / f"mesh-{name}.vtk", dim=2)[0]
            for name in ("metal", "rubber", "air")
        ],
        merge=True,
    )
    mesh = meshes.stack()
    radius = np.linalg.norm(mesh.points, axis=1)
    regions = [fem.RegionQuad(m) for m in meshes]
    fields = [fem.FieldsMixed(r, n=1, planestrain=True) for r in regions]
    field = fem.FieldContainer(fields).merge()
    metal = np.isin(np.arange(mesh.npoints), np.unique(meshes[0].cells))
    inner = np.logical_and(metal, radius <= 45)
    outer = np.logical_and(metal, radius > 45)
    boundaries = dict(
        fixed=fem.Boundary(field[0], mask=outer),
        u_x=fem.Boundary(field[0], mask=inner, skip=(0, 1)),
        u_y=fem.Boundary(field[0], mask=inner, skip=(1, 0)),
    )
    rubber = fem.SolidBodyNearlyIncompressible(fem.NeoHooke(mu=1), fields[1], bulk=100)
    air = fem.SolidBody(fem.NeoHooke(mu=1 / 75), fields[2])
    ramp = {boundaries["u_y"]: fem.math.linsteps([0, 3], num=3)}
    step = fem.Step(items=[rubber, air], ramp=ramp, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["u_y"])
    job.evaluate(verbose=0)
    return np.array(job.x)[:, 1], np.array(job.y)[:, 1]


def test_engine_mount_like_ex07(monkeypatch):
    # the vertical force of the sample (with FElupe's tolerance) is the one of the
    # example ex07 of FElupe (#241): air without a volumetric part (u-isochoric) and
    # rigid metal parts, whose points (of their sections) are moved by boundaries
    folder = APP / "public" / "samples" / "engine-mount"
    x, y = ex07()
    monkeypatch.chdir(folder)
    document = loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    commands = []
    for cmd in document["commands"]:
        if cmd["command"] == "job.add" and cmd["name"] == "horizontal":
            continue
        if cmd["command"] == "job.add":
            cmd["tol"] = 1.49e-8
        commands.append(cmd)
    document["commands"] = commands
    results = run(document)["vertical"]
    np.testing.assert_allclose(np.array(results["x"])[:, 1], x)
    np.testing.assert_allclose(np.array(results["y"])[:, 1], y, rtol=1e-8)
    assert y[-1] == pytest.approx(19.773, rel=1e-4)
