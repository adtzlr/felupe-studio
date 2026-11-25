"""User-defined materials of Python files (#423, ADR 0025): the helper of the script,
the generated script, the files and the scripts of a project, and the server that
runs a script only if it may."""

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
    # written by the server: it runs
    text = (folder / "material_constitutive.py").read_text(encoding="utf-8")
    session.write_file("material_constitutive.py", text)
    assert session.solve()["job_1"]["substeps"] == 6
    # the files of the project, also in an archive
    saved = session.save_project(folder / "bar.felupe.zip")
    assert saved["files"] == ["material_constitutive.py"]
