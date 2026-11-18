"""The MCP server of FElupe Studio (#239): its tools on a project built command by
command, on the samples, and the protocol with the client of the SDK."""

import asyncio
import json
import shutil
import sys
from pathlib import Path

import meshio
import numpy as np
import pytest

pytest.importorskip("mcp")

from mcp import Client, StdioServerParameters  # noqa: E402
from mcp.server.mcpserver.exceptions import ToolError  # noqa: E402

from felupe_studio import codegen  # noqa: E402
from felupe_studio.mcp import Session, schema, server  # noqa: E402

GOLDEN = Path(__file__).parent / "golden"
SAMPLES = Path(__file__).parents[1] / "app" / "public" / "samples"


def test_schema_of_the_commands():
    overview = schema()
    names = [c["command"] for c in overview["commands"]]
    assert {"mesh.import", "material.add", "section.add", "job.add"} <= set(names)
    assert all(c["description"] for c in overview["commands"])
    # a command with the definitions it references
    material = schema("material.add")
    assert material["$ref"] == "#/$defs/MaterialAdd"
    assert {"MaterialNeoHooke", "Name"} <= set(material["$defs"])
    with pytest.raises(ToolError, match="Unknown command 'mesh.load'"):
        schema("mesh.load")


def test_build_solve_and_save(tmp_path):
    # the uniaxial tension of a cube of the golden case cube_yeoh, command by command
    document = json.loads((GOLDEN / "cube_yeoh" / "commands.json").read_text())
    session = Session()
    with pytest.raises(ToolError, match="No project"):
        session.add_command(document["commands"][0])
    folder = tmp_path / "cube"
    summary = session.new_project(folder, "cube")
    assert summary["project"] == str(folder / "cube.felupe.json")
    shutil.copy(GOLDEN / "cube_yeoh" / "cube.vtu", folder)
    info = session.inspect_mesh("cube.vtu")
    assert info["solids"][0]["cell_type"] == "hexahedron"

    mesh, cells, material, section, *rest = document["commands"]
    for command in (mesh, cells):
        assert session.add_command(command)["errors"] == []
    # a command that does not fit its schema is not added
    with pytest.raises(ToolError, match="Not added"):
        session.add_command({**material, "parameters": {"C10": "soft"}})
    # a reference to a later command is an error, fixed by adding it before
    issues = session.add_command(section)
    assert any("unknown material 'rubber'" in e for e in issues["errors"])
    assert session.add_command(material, before="body")["errors"] == []
    for command in rest:
        assert session.add_command(command)["errors"] == []
    assert session.script() == codegen(session.document)

    curve = session.solve()["job_1"]["curve"]
    expected = json.loads((GOLDEN / "cube_yeoh" / "results.json").read_text())
    force = np.array(curve["y"])[:, 0]
    np.testing.assert_allclose(force, expected["jobs"]["job_1"]["force"], rtol=1e-6)
    result = session.results("job_1", "stress_max")
    assert result["substep"] == result["substeps"] == 6
    assert result["extremes"]["max"]["value"] == pytest.approx(result["range"][1])
    with pytest.raises(ToolError, match="Unknown quantity"):
        session.results("job_1", "stress")
    written = session.export("job_1", "vtu", "results/cube.vtu")
    assert meshio.read(written["written"]).point_data["Displacement"].shape[1] == 3

    # a renamed command: the references follow; a used one is not deleted
    session.update_command("tension", {"name": "pull"})
    assert session.find("step_1")[1]["ramp"]["items"][0]["target"] == "pull"
    assert session.find("job_1")[1]["curve"] == "pull"
    with pytest.raises(ToolError, match="used by step_1, job_1"):
        session.delete_command("pull")
    assert session.solved is None

    # the project file and the archive open again with the same commands
    saved = session.save_project()
    assert saved["files"] == ["cube.vtu"]
    other = Session()
    assert other.open_project(folder / "cube.felupe.json")["errors"] == []
    assert other.document == session.document
    archive = session.save_project(tmp_path / "cube.felupe.zip")["saved"]
    unpacked = Session()
    unpacked.open_project(archive, tmp_path / "unpacked")
    assert unpacked.document == session.document
    assert (tmp_path / "unpacked" / "cube.vtu").is_file()


def test_a_sample_of_an_installed_package(tmp_path, monkeypatch):
    # pip compiles the mesh script of a sample in the package: its folder has a
    # __pycache__, which is not copied (#275)
    samples = tmp_path / "samples"
    shutil.copytree(SAMPLES / "plate-with-hole", samples / "plate-with-hole")
    (samples / "plate-with-hole" / "__pycache__").mkdir()
    (samples / "plate-with-hole" / "__pycache__" / "plate_with_hole.pyc").write_bytes(
        b""
    )
    monkeypatch.setenv("FELUPE_STUDIO_SAMPLES", str(samples))
    session = Session()
    session.open_sample("plate-with-hole", tmp_path / "plate")
    assert sorted(p.name for p in (tmp_path / "plate").iterdir()) == [
        "plate-with-hole.felupe.json",
        "plate_with_hole.py",
    ]
    assert not session.issues()["errors"]


def test_files_stay_in_the_project_folder(tmp_path):
    session = Session()
    session.new_project(tmp_path / "model")
    with pytest.raises(ToolError, match="not a file in the project folder"):
        session.write_file("../outside.py", "print('no')")


def test_mesh_scripts_run_only_if_trusted(tmp_path):
    # the plate with a hole, copied by hand: its script came from elsewhere
    folder = tmp_path / "plate"
    shutil.copytree(SAMPLES / "plate-with-hole", folder)
    (folder / "model.felupe.json").rename(folder / "plate.felupe.json")
    session = Session()
    session.open_project(folder / "plate.felupe.json")
    with pytest.raises(ToolError, match="--allow-scripts"):
        session.solve()
    with pytest.raises(ToolError, match="did not write it"):
        session.inspect_mesh("plate_with_hole.py")
    # written by the server: it runs, until it changes
    text = (folder / "plate_with_hole.py").read_text(encoding="utf-8")
    session.write_file("plate_with_hole.py", text)
    assert session.inspect_mesh("plate_with_hole.py")["solids"]
    (folder / "plate_with_hole.py").write_text(text + "\n# changed\n")
    with pytest.raises(ToolError, match="or it changed since"):
        session.solve()
    # or the server allows the scripts
    allowed = Session(allow_scripts=True)
    allowed.open_project(folder / "plate.felupe.json")
    assert allowed.solve()["job"]["substeps"] > 0


def call(client, tool, arguments=None, **kwargs):
    return client.call_tool(tool, arguments or {}, **kwargs)


def test_the_protocol(tmp_path):
    # the tools over MCP with the client of the SDK, in-process: the plate with a
    # hole, solved, with the largest principal stress (#239)
    async def main():
        async with Client(server(Session())) as client:
            tools = {t.name for t in (await client.list_tools()).tools}
            assert {"schema", "add_command", "solve", "results", "export"} <= tools

            samples = (await call(client, "samples")).structured_content["result"]
            assert "plate-with-hole" in [s["id"] for s in samples]
            folder = str(tmp_path / "plate")
            opened = await call(
                client, "open_sample", {"sample": "plate-with-hole", "folder": folder}
            )
            assert opened.structured_content["errors"] == []

            progress = []

            async def report(done, total, message):
                progress.append((done, total, message))

            solved = await call(client, "solve", progress_callback=report)
            assert not solved.is_error
            curve = solved.structured_content["job"]["curve"]
            assert len(curve["y"]) == len(progress) == progress[-1][1]
            assert progress[-1][2].startswith("job: ")

            stress = await call(
                client,
                "results",
                {"job": "job", "quantity": "stress_max", "method": "project"},
            )
            peak = stress.structured_content["extremes"]["max"]
            assert peak["at"] == "point" and peak["value"] > 0.7

            failed = await call(client, "results", {"job": "other"})
            assert failed.is_error and "No results of job 'other'" in str(
                failed.content[0].text
            )

            saved = await call(client, "save_project")
            assert saved.structured_content["files"] == ["plate_with_hole.py"]

            resources = {str(r.uri) for r in (await client.list_resources()).resources}
            assert "felupe-studio://docs/guide" in resources
            guide = await client.read_resource("felupe-studio://docs/guide")
            assert "FElupe Studio" in guide.contents[0].text

    asyncio.run(main())


def test_stdio():
    # the command of the server, as an MCP client starts it
    async def main():
        command = [sys.executable, "-m", "felupe_studio.mcp"]
        params = StdioServerParameters(command=command[0], args=command[1:])
        async with Client(params) as client:
            assert client.server_info.name == "felupe-studio"
            overview = await call(client, "schema")
            assert len(overview.structured_content["commands"]) > 20

    asyncio.run(main())


def test_tool_cases_are_up_to_date():
    # the answers of the tools that the agent bridge of the app gives too (#258)
    sys.path.insert(0, str(Path(__file__).parent / "data"))
    from make_tool_cases import CASES, case

    stored = json.loads(
        (Path(__file__).parent / "data" / "tool_cases.json").read_text("utf-8")
    )
    assert stored == [
        {"name": name, "steps": case(steps)} for name, steps in CASES.items()
    ], "Run python tests/data/make_tool_cases.py and commit the result."
