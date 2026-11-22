"""The results of a file (#414): the XDMF export of the results of a job, read back
and shown like the results of its run."""

import json
import xml.etree.ElementTree as ET
from pathlib import Path

import meshio
import numpy as np
import pytest

from felupe_studio import resultfile, results
from felupe_studio.runner import run

GOLDEN = Path(__file__).parent / "golden"


def solve(case, monkeypatch):
    """Run the jobs of a golden case."""
    monkeypatch.chdir(GOLDEN / case)
    run(json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8")))


def scenes(job, quantities, method="cells", cut=None):
    """The scenes of quantities of all substeps of a job: their meta data, without
    ``shift`` (no method of a file is projected instead, see below), and their
    surfaces."""
    shown = []
    for quantity in quantities:
        for substep in range(1, results._source().substeps(job) + 1):
            meta, surfaces = results.scene(job, substep, quantity, method, cut)
            meta = json.loads(meta)
            meta.pop("shift")
            shown.append((meta, surfaces))
    return shown


def middle():
    """A cut of the view (#395) through the middle of the first section in x."""
    points = results._source().mesh(results._state["sections"][0])[0]
    return {"axis": "x", "value": float(points[:, 0].mean()), "half": "+"}


def imported(job, data, name=None):
    """Show the results of an export of a job, and return their description."""
    return json.loads(resultfile.load(name or f"model-{job}.xdmf", data))


def information(data):
    """The information of the export of an XDMF file."""
    domain = ET.fromstring(data).find("Domain")
    return domain.find(f"Information[@Name='{results.INFORMATION}']")


@pytest.mark.parametrize(
    "case, quantities",
    [
        # two sections of the same cell type, one block of cells of meshio
        ("bar_two_materials", ["displacement", "strain_min", "stress_mises"]),
        # two sections of two cell types
        ("bar_cell_types", ["displacement_y", "stress_max"]),
        # the equivalent plastic strain of an elastic-plastic material (#191)
        ("plasticity_cube", ["stress_mises", "plastic_strain"]),
        # the maximum strain energy density of the Mullins effect (#346)
        ("cube_mullins_neo_hooke", ["mullins_energy"]),
        # a 2D model (#175)
        ("plate_plane_strain", ["displacement", "stress_mises"]),
    ],
)
def test_a_file_shows_the_results_of_its_run(case, quantities, monkeypatch):
    solve(case, monkeypatch)
    sections = results._state["sections"]
    cut = middle()
    expected = scenes("job_1", quantities), scenes("job_1", quantities, cut=cut)
    ranges = [results.ranges("job_1", quantity) for quantity in quantities]

    description = imported("job_1", results.export("job_1", "xdmf"))
    job = description["job"]
    assert job == "model-job_1"
    assert description["sections"] == results._state["sections"] == sections
    # the same scenes, ranges and extremes, also of a cut (#395)
    assert (scenes(job, quantities), scenes(job, quantities, cut=cut)) == expected
    assert [results.ranges(job, quantity) for quantity in quantities] == ranges


def test_the_description_of_a_file(monkeypatch):
    solve("plasticity_cube", monkeypatch)
    data = results.export("job_1", "xdmf")
    assert imported("job_1", data, "steel/cube-job_1.xdmf") == {
        "file": "steel/cube-job_1.xdmf",
        "job": "cube-job_1",
        "substeps": results._source().substeps("cube-job_1"),
        "sections": ["body"],
        "planar": False,
        "units": {"length": "mm", "force": "N"},
        "quantities": [
            *("displacement", "displacement_x", "displacement_y", "displacement_z"),
            *("strain_max", "strain_mid", "strain_min"),
            *("stress_max", "stress_mid", "stress_min", "stress_mises"),
            "plastic_strain",
        ],
    }

    # a 2D model has no displacement in z (#175)
    solve("plate_plane_strain", monkeypatch)
    description = imported("job_1", results.export("job_1", "xdmf"))
    assert description["planar"] and description["units"] is None
    assert "displacement_z" not in description["quantities"]
    assert "strain_min" in description["quantities"]
    assert "plastic_strain" not in description["quantities"]


def test_values_at_the_points_as_exported(monkeypatch):
    # one section: the values at the points of the export are those of the view
    solve("bar_single_body", monkeypatch)
    quantities = ["strain_max", "stress_mises"]
    expected = scenes("job_1", quantities, "mean")
    data = results.export("job_1", "xdmf", method="mean")
    job = imported("job_1", data)["job"]
    assert scenes(job, quantities, "mean") == expected
    # every method at the points takes them, nothing is projected instead
    for method in ("project", "topoints"):
        meta, _ = results.scene(job, 3, "stress_mises", method)
        assert json.loads(meta)["at"] == "point"
        assert json.loads(meta)["shift"] is True
    with pytest.raises(ValueError, match="Unknown method"):
        results.scene(job, 3, "stress_mises", "nodes")

    # a file without them: the values stay at the cells
    solve("bar_single_body", monkeypatch)
    expected = scenes("job_1", quantities)
    job = imported("job_1", results.export("job_1", "xdmf"))["job"]
    assert scenes(job, quantities, "mean") == expected


def test_the_export_has_the_sections_and_the_units(monkeypatch, tmp_path):
    solve("plasticity_cube", monkeypatch)
    data = results.export("job_1", "xdmf")
    assert json.loads(information(data).get("Value")) == {
        "sections": ["body"],
        "units": {"length": "mm", "force": "N"},
    }
    # meshio reads the file as before
    path = tmp_path / "results.xdmf"
    path.write_bytes(data)
    with meshio.xdmf.TimeSeriesReader(path) as reader:
        points, cells = reader.read_points_cells()
        assert reader.num_steps == results.substeps("job_1")
        assert reader.read_data(0)[0] == 1


def test_a_file_without_the_information(monkeypatch):
    # e.g. of FElupe Studio 0.10: the sections by their index, as in ParaView
    solve("bar_two_materials", monkeypatch)
    root = ET.fromstring(results.export("job_1", "xdmf"))
    domain = root.find("Domain")
    domain.remove(domain.find("Information"))
    data = ET.tostring(root)
    assert information(data) is None
    description = imported("job_1", data)
    assert description["sections"] == ["Section 0", "Section 1"]
    assert description["units"] is None
    meta, _ = results.scene(description["job"], 1, "displacement")
    assert list(json.loads(meta)["sections"]) == ["Section 0", "Section 1"]


def test_the_results_of_a_file_replace_those_of_the_run(monkeypatch):
    solve("bar_two_materials", monkeypatch)
    data = results.export("job_1", "xdmf")
    job = imported("job_1", data)["job"]
    # no results of the run any more, and none of other jobs
    assert results.substeps("job_1") == 0
    with pytest.raises(KeyError):
        results.scene("job_1", 1, "displacement")
    with pytest.raises(KeyError):
        results.export("job_1", "vtu")
    assert json.loads(results.ranges("job_1", "displacement"))["range"] == []
    with pytest.raises(IndexError, match="has 6 substeps"):
        results.scene(job, 7, "displacement")
    meta, _ = results.scene(job, 6, "displacement")
    assert json.loads(meta)["points"] == []
    # a quantity that the file does not have
    with pytest.raises(KeyError, match="no Equivalent Plastic Strain"):
        results.scene(job, 6, "plastic_strain")

    # a new run replaces them
    solve("bar_two_materials", monkeypatch)
    assert results.substeps("job_1") == 6
    assert results._source().substeps(job) == 0


@pytest.mark.parametrize(
    "data, message",
    [
        (b"not a file of results", "is not an XDMF time series"),
        (b'<?xml version="1.0"?><VTKFile/>', "is not an XDMF time series"),
    ],
)
def test_files_that_are_not_results(data, message, monkeypatch):
    solve("bar_two_materials", monkeypatch)
    with pytest.raises(ValueError, match=message):
        resultfile.load("other.xdmf", data)
    # the results of the run stay
    assert results.substeps("job_1") == 6


def test_time_series_without_results(tmp_path):
    points = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1.0]])
    cells = [("tetra", np.array([[0, 1, 2, 3]]))]
    path = tmp_path / "mesh.xdmf"
    with meshio.xdmf.TimeSeriesWriter(path, data_format="XML") as writer:
        writer.write_points_cells(points, cells)
    with pytest.raises(ValueError, match="has no time steps"):
        resultfile.load("mesh.xdmf", path.read_bytes())
    with meshio.xdmf.TimeSeriesWriter(path, data_format="XML") as writer:
        writer.write_points_cells(points, cells)
        writer.write_data(0.0, {"u": points}, {})
    with pytest.raises(ValueError, match="no point data 'Displacement'"):
        resultfile.load("mesh.xdmf", path.read_bytes())
    with meshio.xdmf.TimeSeriesWriter(path, data_format="XML") as writer:
        writer.write_points_cells(points, cells)
        writer.write_data(0.0, {"Displacement": points}, {})
    with pytest.raises(ValueError, match="no cell data 'Section'"):
        resultfile.load("mesh.xdmf", path.read_bytes())
