"""The requests of the app (#311): one layer for the Pyodide worker and the local
runtime of felupe-studio serve, tested in CPython on both paths."""

import json
import sys
from pathlib import Path

import pytest

from felupe_studio.frames import decode, encode, restore
from felupe_studio.requests import handle, handle_frame

GOLDEN = Path(__file__).parent / "golden" / "cube_yeoh"
DOCUMENT = (GOLDEN / "commands.json").read_text(encoding="utf-8")
MESH = (GOLDEN / "cube.vtu").read_bytes()


class JsBuffer:
    """A JavaScript ``Uint8Array`` as Pyodide passes it to Python: its bytes by
    ``to_bytes()``."""

    def __init__(self, data):
        self.data = bytes(data)

    def to_bytes(self):
        return self.data


def local(request):
    """The answers of the local runtime: handle() in its process."""
    messages = []
    handle(request, messages.append)
    return messages


def pyodide(request):
    """The answers of the Pyodide worker: a frame of encodeFrame() in, the parts of
    a frame out (``send(text, buffers)``), restored like ``restore()`` of the app."""
    frame = encode(request)
    frame = frame if isinstance(frame, str) else JsBuffer(frame)
    messages = []
    handle_frame(
        frame, lambda text, buffers: messages.append(restore(json.loads(text), buffers))
    )
    return messages


@pytest.fixture(params=[local, pyodide])
def answers(request):
    return request.param


def test_the_requests_of_the_app(answers, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # files stay in the folder of the session
    assert answers(
        {"type": "write-file", "id": 1, "name": "../cube.vtu", "data": MESH}
    ) == [{"type": "done", "id": 1}]
    assert (tmp_path / "cube.vtu").read_bytes() == MESH

    [info] = answers({"type": "inspect-mesh", "id": 2, "name": "cube.vtu"})
    assert info["type"] == "mesh-info" and info["info"]["points"] > 0
    surface = info["surfaces"]["hexahedron"]
    assert isinstance(surface["positions"], bytes) and surface["cells"] > 0
    # the message travels as a binary frame
    assert decode(encode(info))["surfaces"] == info["surfaces"]

    [checked] = answers({"type": "check", "id": 12, "document": DOCUMENT})
    report = json.loads(checked["text"])
    assert report["ok"] and report["cells"]["total"] > 0

    [script] = answers({"type": "script", "id": 3, "document": DOCUMENT})
    assert "import felupe as fem" in script["text"]
    [view] = answers({"type": "script-view", "id": 4, "document": DOCUMENT})
    assert "job_1" in json.loads(view["text"])["lines"]

    live = {"quantity": "displacement", "interval": 0, "budget": 1}
    run = answers({"type": "run", "id": 5, "document": DOCUMENT, "live": live})
    events = [m["event"]["event"] for m in run if m["type"] == "job-progress"]
    assert events[0] == "start" and "substep" in events and "finished" in events
    scenes = [m["event"]["scene"] for m in run if "scene" in m.get("event", {})]
    assert scenes and isinstance(scenes[0]["surfaces"][0]["values"], bytes)
    assert run[-1]["type"] == "job-result"
    assert run[-1]["results"]["job_1"]["substeps"] == 6

    [scene] = answers(
        {
            "type": "result",
            "id": 6,
            "job": "job_1",
            "substep": 5,
            "quantity": "displacement",
        }
    )
    assert scene["type"] == "result-scene" and scene["scene"]["surfaces"]
    [ranges] = answers(
        {"type": "result-ranges", "id": 7, "job": "job_1", "quantity": "displacement"}
    )
    assert len(json.loads(ranges["text"])) == 6
    [vtu] = answers(
        {
            "type": "export-results",
            "id": 8,
            "job": "job_1",
            "format": "vtu",
            "substep": 5,
        }
    )
    assert vtu["type"] == "bytes" and vtu["data"].startswith(b"<?xml")
    [mesh] = answers(
        {"type": "export-mesh", "id": 9, "file": "cube.vtu", "format": "vtk"}
    )
    assert mesh["type"] == "bytes" and b"vtk" in mesh["data"][:100].lower()

    # an error has the traceback, like the worker
    [error] = answers({"type": "inspect-mesh", "id": 10, "name": ".."})
    assert error["type"] == "error" and error["id"] == 10
    assert error["message"].startswith("Traceback")
    assert "Invalid file name '..'." in error["message"]
    [unknown] = answers({"type": "init", "id": 11})
    assert "Unknown request 'init'." in unknown["message"]

    # the benchmark of the spike, also in single precision (ADR 0016)
    *progress, result, done = answers(
        {"type": "benchmark", "id": 13, "sizes": [2], "precision": "single"}
    )
    assert progress[0]["type"] == "progress" and done == {"type": "done", "id": 13}
    assert result["result"]["precision"] == "single" and result["result"]["dofs"] == 24


def test_scripts_make_meshes(answers, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    script = "import felupe as fem\nmesh = fem.Cube(n=n)\n"
    answers({"type": "write-file", "id": 1, "name": "cube.py", "data": script.encode()})
    request = {"type": "make-mesh", "id": 2, "file": "cube.py", "parameters": {"n": 3}}
    [info] = answers(request)
    assert info["info"]["points"] == 27
    [broken] = answers({**request, "parameters": {}})
    assert "traceback" in broken["info"]


def test_tools_make_meshes(answers):
    # the meshes of the tools of FElupe (ADR 0019): the commands of the tools with
    # the values of their expressions; a line is a construction mesh with its lines
    line = {"command": "mesh.generate", "name": "edge", "tool": "Line"}
    request = {
        "type": "generate-mesh",
        "id": 1,
        "commands": [{**line, "parameters": {"a": 0, "b": 2, "n": 5}}],
        "name": "edge",
    }
    [info] = answers(request)
    assert info["info"]["dimension"] == {"points": 1, "cells": 1, "cell_type": "line"}
    assert info["info"]["solids"] == []
    assert list(info["surfaces"]) == ["line"]
    cube = {"command": "mesh.generate", "name": "block", "tool": "Cube"}
    parameters = {"a": [0, 0, 0], "b": [2, 1, 1], "n": [3, 2, 2]}
    [info] = answers(
        {**request, "commands": [{**cube, "parameters": parameters}], "name": "block"}
    )
    [solid] = info["info"]["solids"]
    assert solid["cell_type"] == "hexahedron" and solid["cells"] == 2
    assert solid["bounds"] == [[0, 0, 0], [2, 1, 1]]


def test_both_paths_give_the_same_messages(tmp_path, monkeypatch):
    """The worker and the local runtime get the same messages, bytes included."""
    monkeypatch.chdir(tmp_path)
    write = {"type": "write-file", "id": 1, "name": "cube.vtu", "data": MESH}
    assert local(write) == pyodide(write)
    for request in (
        {"type": "inspect-mesh", "id": 2, "name": "cube.vtu"},
        {"type": "script", "id": 3, "document": DOCUMENT},
        {"type": "export-mesh", "id": 4, "file": "cube.vtu", "format": "vtk"},
        {"type": "unknown", "id": 5},
    ):
        expected = local(request)
        assert pyodide(request) == expected
        assert [decode(encode(m)) for m in expected] == expected


def test_the_checks_need_jsonschema(monkeypatch):
    """Pyodide has no jsonschema: the checks of the mesh data are local only."""
    monkeypatch.setitem(sys.modules, "jsonschema", None)
    [error] = pyodide({"type": "check", "id": 1, "document": DOCUMENT})
    assert error["type"] == "error" and error["id"] == 1
    assert "need the local runtime of felupe-studio serve" in error["message"]
