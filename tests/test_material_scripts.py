"""User-defined materials of Python files (#423, ADR 0025): the helper of the script,
the generated script, the files and the scripts of a project, the run of a script
before a job, and the server that runs a script only if it may."""

import json
import shutil
from importlib.resources import files
from pathlib import Path

import felupe as fem
import pytest

from felupe_studio import runner
from felupe_studio._helpers import run_material_script
from felupe_studio.codegen import codegen
from felupe_studio.commands import file_names, script_names
from felupe_studio.scripts import inspect_material

GOLDEN = Path(__file__).parent / "golden" / "bar_material_script"
TEMPLATE = files("felupe_studio").joinpath("templates/material_constitutive.py")


def document():
    return json.loads((GOLDEN / "commands.json").read_text(encoding="utf-8"))


def test_the_template_makes_a_constitutive_model_of_the_parameters():
    umat = run_material_script(TEMPLATE, {"mu": 2.0, "bulk": 40.0})
    assert isinstance(umat, fem.NeoHooke)
    assert (umat.mu, umat.bulk) == (2.0, 40.0)
    # alone, with the values of the template
    umat = run_material_script(TEMPLATE, {})
    assert (umat.mu, umat.bulk) == (1.0, 5000.0)


def test_a_script_without_a_constitutive_model(tmp_path):
    path = tmp_path / "soft.py"
    path.write_text("material = 1\n")
    with pytest.raises(ValueError, match="makes no variable 'umat'"):
        run_material_script(path, {})
    path.write_text("umat = 1\n")
    message = "is a int without the methods gradient and hessian of a constitutive"
    with pytest.raises(TypeError, match=message):
        run_material_script(path, {})
    path.write_text(
        "class Material:\n    def gradient(self, x):\n        return x\n\n"
        "umat = Material()\n"
    )
    with pytest.raises(TypeError, match="is a Material without the method hessian"):
        run_material_script(path, {})


def test_a_script_with_an_error_raises_it(tmp_path):
    # e.g. a parameter that the model does not give: the error of the job
    path = tmp_path / "soft.py"
    path.write_text("import felupe as fem\n\numat = fem.NeoHooke(mu=mu)\n")
    with pytest.raises(NameError, match="'mu'"):
        run_material_script(path, {})


def test_a_script_runs_once_before_a_job():
    # what the template makes with the parameters of the model
    assert inspect_material(TEMPLATE, {"mu": 2.0, "bulk": 40.0}) == {
        "file": "material_constitutive.py",
        "type": "NeoHooke",
        "statevars": 0,
    }


def test_what_a_script_makes(tmp_path):
    path = tmp_path / "soft.py"
    path.write_text(
        "import felupe as fem\n\n"
        "umat = fem.Hyperelastic(fem.neo_hooke, mu=mu) & fem.Volumetric(bulk=bulk)\n"
    )
    info = inspect_material(path, {"mu": 1.0, "bulk": 50.0})
    assert info["type"] == "Hyperelastic(neo_hooke) & Volumetric"
    # the state variables of the last array of umat.x, like fem.SolidBody
    path.write_text(
        "import felupe as fem\n\n"
        "umat = fem.OgdenRoxburgh(fem.NeoHooke(mu=1.0), r=3.0, m=1.0, beta=0.0)\n"
    )
    assert inspect_material(path, {})["statevars"] == 1
    path.write_text(
        "import felupe as fem\n\n"
        "umat = fem.MaterialStrain(\n"
        "    fem.linear_elastic_plastic_isotropic_hardening,\n"
        "    λ=1.0, μ=1.0, σy=1.0, K=1.0, statevars=(1, (3, 3)),\n"
        ")\n"
    )
    info = inspect_material(path, {})
    assert info["type"] == "MaterialStrain(linear_elastic_plastic_isotropic_hardening)"
    # the 10 of its function and those that fem.MaterialStrain keeps itself
    assert info["statevars"] == 28
    # an object of a class of its own, without x: no state variables
    path.write_text(
        "class Soft:\n"
        "    def gradient(self, x):\n        return x\n\n"
        "    def hessian(self, x):\n        return x\n\n"
        "umat = Soft()\n"
    )
    assert inspect_material(path, {}) == {
        "file": "soft.py",
        "type": "Soft",
        "statevars": 0,
    }


def test_the_error_of_a_script_with_its_traceback(tmp_path):
    path = tmp_path / "soft.py"
    path.write_text(
        "import felupe as fem\n\n\ndef soft():\n    return fem.NeoHooke(mu=mu)\n\n"
        "umat = soft()\n"
    )
    info = inspect_material(path, {})
    assert info["error"] == "NameError: name 'mu' is not defined"
    # the frames of the script, not those of FElupe Studio
    assert "_helpers.py" not in info["traceback"]
    assert 'soft.py", line 7, in <module>' in info["traceback"]
    assert 'soft.py", line 5, in soft' in info["traceback"]
    path.write_text("umat = 1\n")
    assert inspect_material(path, {})["error"].startswith("TypeError: The umat of")
    # also an exit of the script
    path.write_text("raise SystemExit(3)\n")
    assert inspect_material(path, {})["error"] == "SystemExit: 3"


def test_the_helper_only_in_scripts_with_materials_of_files():
    script = codegen(document())
    assert script.count("def run_material_script(file, parameters):") == 1
    line = 'rubber = run_material_script("material_constitutive.py", {"mu": mu, '
    assert line in script
    # the listed parameters only
    commands = document()["commands"]
    for c in commands:
        if c["command"] == "material.script":
            c["parameters"] = ["mu"]
    listed = codegen({"schema_version": 3, "commands": commands})
    assert '("material_constitutive.py", {"mu": mu})\n' in listed
    # a material of the registry instead: no helper
    for i, c in enumerate(commands):
        if c["command"] == "material.script":
            commands[i] = {
                "command": "material.add",
                "name": "rubber",
                "model": "NeoHooke",
                "parameters": {"mu": "mu", "bulk": "bulk"},
            }
    assert "run_material_script" not in codegen(
        {"schema_version": 3, "commands": commands}
    )


def test_the_files_and_the_scripts_of_a_project():
    commands = [
        {"command": "mesh.import", "name": "bar", "file": "bar.vtu"},
        {"command": "mesh.script", "name": "spring", "file": "spring.py"},
        {
            "command": "material.script",
            "name": "soft",
            "kind": "constitutive",
            "file": "soft.py",
        },
        {"command": "mesh.import", "name": "other", "file": "bar.vtu"},
    ]
    assert file_names(commands) == ["bar.vtu", "soft.py", "spring.py"]
    assert script_names(commands) == ["soft.py", "spring.py"]


def test_a_material_of_a_file_loads_tensortrax():
    # the file may use fem.Hyperelastic, which the browser has with tensortrax only
    assert runner.uses_tensortrax(document())
    assert runner.uses_tensortrax(json.dumps(document()))


def test_material_scripts_run_only_if_trusted(tmp_path):
    pytest.importorskip("mcp")
    from mcp.server.mcpserver.exceptions import ToolError

    from felupe_studio.mcp import Session

    # the golden case, copied by hand: its script came from elsewhere
    folder = tmp_path / "bar"
    shutil.copytree(GOLDEN, folder)
    (folder / "commands.json").rename(folder / "bar.felupe.json")
    session = Session()
    session.open_project(folder / "bar.felupe.json")
    message = "The script 'material_constitutive.py' runs Python code"
    with pytest.raises(ToolError, match=message):
        session.solve()
    with pytest.raises(ToolError, match=message):
        session.inspect_material("material_constitutive.py")
    # written by the server: it runs
    text = (folder / "material_constitutive.py").read_text(encoding="utf-8")
    session.write_file("material_constitutive.py", text)
    # once, with the parameters of the model, changed by the call
    info = session.inspect_material("material_constitutive.py", {"bulk": 2.0})
    assert info == {
        "file": "material_constitutive.py",
        "type": "NeoHooke",
        "statevars": 0,
    }
    session.write_file("soft.py", "umat = fem.NeoHooke(mu=mu)\n")
    assert session.inspect_material("soft.py")["error"] == (
        "NameError: name 'fem' is not defined"
    )
    with pytest.raises(ToolError, match="No file 'hard.py'"):
        session.inspect_material("hard.py")
    with pytest.raises(ToolError, match="'bar.felupe.json' is not a Python script"):
        session.inspect_material("bar.felupe.json")
    assert session.solve()["job_1"]["substeps"] == 6
    # the files of the project, also in an archive
    saved = session.save_project(folder / "bar.felupe.zip")
    assert saved["files"] == ["material_constitutive.py"]
