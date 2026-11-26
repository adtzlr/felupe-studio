"""The requests of the app to its Python side (ADR 0005, #311): one layer for both
runtimes, the Pyodide worker and the local runtime of ``felupe-studio serve``.

:func:`handle` answers a request (``ToWorker`` of ``app/src/worker/protocol.ts``,
without ``init``) with the messages of the worker, given to ``send``: progress and
live scenes while a job runs, then a final message, or an error with the traceback.
The arrays of surfaces and scenes are bytes, which the app views as typed arrays.
The local runtime calls :func:`handle` in its process (:mod:`.runtime`), the Pyodide
worker :func:`handle_frame` with a frame of the request; the worker keeps loading
Pyodide and the wheels, the bytecode cache (ADR 0017) and the transfer of the
arrays.
"""

import json
import traceback
from pathlib import Path

from .frames import decode, split


def safe_name(name):
    """A plain file name, so that a file cannot be written outside of the folder of
    the session (the project folder in Pyodide), like ``safeName()`` of the app."""
    base = name.replace("\\", "/").split("/")[-1]
    if base in ("", ".", ".."):
        raise ValueError(f"Invalid file name '{name}'.")
    return base


def _scene(meta, surfaces):
    """A scene of results: its label (JSON text) with its surfaces."""
    return {**json.loads(meta), "surfaces": list(surfaces)}


def _write_file(request, send):
    from . import meshes

    Path(safe_name(request["name"])).write_bytes(request["data"])
    # the kept meshes may be of the old file, or of a script that reads it (#395)
    meshes.forget()
    send({"type": "done", "id": request["id"]})


def _mesh_info(request, send, result):
    info, surfaces = result
    send(
        {
            "type": "mesh-info",
            "id": request["id"],
            "info": json.loads(info),
            "surfaces": surfaces,
        }
    )


def _inspect_mesh(request, send):
    from . import meshes

    # with a cut of the view (#395), the kept cells of the mesh are cut
    cut = request.get("cut")
    _mesh_info(request, send, meshes.load(safe_name(request["name"]), cut))


def _make_mesh(request, send):
    from . import meshes

    parameters = json.dumps(request.get("parameters") or {})
    result = meshes.make_json(
        safe_name(request["file"]), parameters, request.get("item"), request.get("cut")
    )
    _mesh_info(request, send, result)


def _inspect_material(request, send):
    from .scripts import inspect_material

    # the script of a material (ADR 0025), run once with the parameters (#423), or
    # the strain energy function of a file with the values of its material (#424)
    parameters = dict(request.get("parameters") or {})
    material = request.get("material")
    info = inspect_material(safe_name(request["file"]), parameters, material)
    send({"type": "text", "id": request["id"], "text": json.dumps(info)})


def _sources(request):
    """The meshes of files and scripts that the tools of a mesh take (#438), with
    plain file names."""
    sources = request.get("sources") or []
    return [{**spec, "file": safe_name(spec["file"])} for spec in sources]


def _generate_mesh(request, send):
    from . import meshes

    # the resolved commands of the tools that make the mesh (ADR 0019)
    commands = request["commands"]
    if not isinstance(commands, str):
        commands = json.dumps(commands)
    result = meshes.generate_json(
        commands, request["name"], request.get("cut"), _sources(request)
    )
    _mesh_info(request, send, result)


def _run(request, send):
    from . import runner

    id = request["id"]

    def report(text):
        send({"type": "job-progress", "id": id, "event": json.loads(text)})

    def report_scene(text, meta, surfaces):
        event = {**json.loads(text), "scene": _scene(meta, surfaces)}
        send({"type": "job-progress", "id": id, "event": event})

    live = request.get("live")
    results = runner.run_json(
        request["document"], report, json.dumps(live) if live else None, report_scene
    )
    send({"type": "job-result", "id": id, "results": json.loads(results)})


def _script(request, send):
    from . import runner

    view = request["type"] == "script-view"
    text = (runner.script_view if view else runner.script)(request["document"])
    send({"type": "text", "id": request["id"], "text": text})


def _check(request, send):
    try:
        import jsonschema  # noqa: F401
    except ImportError:
        # Pyodide has no jsonschema for the validation of felupe_studio.checks
        raise RuntimeError(
            "The checks of the mesh data need the local runtime of felupe-studio serve."
        ) from None
    from .checks import check

    report = check(json.loads(request["document"]))
    send({"type": "text", "id": request["id"], "text": json.dumps(report)})


def _result(request, send):
    from . import results

    meta, surfaces = results.scene(
        request["job"],
        request["substep"],
        request["quantity"],
        request.get("method") or "cells",
        request.get("cut"),
    )
    scene = _scene(meta, surfaces)
    send({"type": "result-scene", "id": request["id"], "scene": scene})


def _result_ranges(request, send):
    from . import results

    text = results.ranges(
        request["job"], request["quantity"], request.get("method") or "cells"
    )
    send({"type": "text", "id": request["id"], "text": text})


def _export_results(request, send):
    from . import results

    data = results.export(
        request["job"],
        request["format"],
        request.get("substep"),
        request.get("method") or "cells",
    )
    send({"type": "bytes", "id": request["id"], "data": data})


def _import_results(request, send):
    from . import resultfile

    # the results of a file replace those of the last run (#414)
    text = resultfile.load(request["name"], request["data"])
    send({"type": "text", "id": request["id"], "text": text})


def _export_mesh(request, send):
    from . import meshes

    # a mesh made by the tools of FElupe: the commands of its tools (ADR 0019)
    if request.get("commands") is not None:
        data = meshes.export_generated(
            request["commands"], request["file"], request["format"], _sources(request)
        )
        send({"type": "bytes", "id": request["id"], "data": data})
        return
    parameters = request.get("parameters")
    data = meshes.export_json(
        safe_name(request["file"]),
        request["format"],
        json.dumps(parameters) if parameters is not None else None,
        request.get("item"),
        request.get("cellType"),
        request.get("scale"),
    )
    send({"type": "bytes", "id": request["id"], "data": data})


def _benchmark(request, send):
    from .benchmark import benchmark

    for n in request["sizes"]:
        send({"type": "progress", "id": request["id"], "message": f"Running n = {n} …"})
        result = benchmark(
            n=n,
            num=5,
            precision=request.get("precision", "double"),
            # the cube of a way of u-p-J (#420), or the compressible one
            formulation=request.get("formulation"),
        )
        send({"type": "benchmark-result", "id": request["id"], "result": result})
    send({"type": "done", "id": request["id"]})


HANDLERS = {
    "write-file": _write_file,
    "inspect-mesh": _inspect_mesh,
    "make-mesh": _make_mesh,
    "generate-mesh": _generate_mesh,
    "inspect-material": _inspect_material,
    "run": _run,
    "script": _script,
    "script-view": _script,
    "check": _check,
    "result": _result,
    "result-ranges": _result_ranges,
    "export-results": _export_results,
    "import-results": _import_results,
    "export-mesh": _export_mesh,
    "benchmark": _benchmark,
}
"""The requests of the app (``ToWorker`` of the protocol, without ``init``)."""


def handle(request, send):
    """Answer a request of the app with messages given to ``send``, like the worker:
    its answers end with a final message or an error with the traceback."""
    try:
        handler = HANDLERS.get(request.get("type"))
        if handler is None:
            raise ValueError(f"Unknown request '{request.get('type')}'.")
        handler(request, send)
    except Exception:
        send(
            {
                "type": "error",
                "id": request.get("id"),
                "message": traceback.format_exc(),
            }
        )


def handle_frame(frame, send):
    """Answer a request of the Pyodide worker: the request as a frame of
    ``encodeFrame()`` (its text, or its bytes as a JavaScript ``Uint8Array``), every
    answer as ``send(text, buffers)``, the parts of a frame (:func:`.frames.split`),
    so the worker gets the messages of the local runtime without a frame of all
    buffers."""
    data = frame if isinstance(frame, str) else frame.to_bytes()
    handle(decode(data), lambda message: send(*split(message)))
