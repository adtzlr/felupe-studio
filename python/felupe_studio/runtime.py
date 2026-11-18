"""The Python side of the app in a process of its own: the local runtime of
``felupe-studio serve`` (#240, ADR 0014).

The app talks to it with the messages of its Pyodide worker
(``app/src/worker/protocol.ts``, ADR 0005). :func:`handle` answers a request like the
worker, with the same functions of the package; the arrays of surfaces and scenes
stay bytes, which the app decodes like those of Pyodide. :func:`session` is a
process of a connection of the app: it works in a folder of its own, holds the
state of the results and ends with the connection. :func:`encode` and
:func:`decode` turn the messages into the frames of the WebSocket.
"""

import json
import os
import struct
import sys
import time
import traceback
from pathlib import Path

from .__about__ import __version__

ALIGN = 8
"""The alignment of the header and the buffers of a binary frame, so that the app
views the arrays of 8-byte floats without a copy."""


def _pad(size):
    return -size % ALIGN


def _numbers(value):
    """A NumPy scalar as a plain number, for JSON."""
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"{type(value).__name__} is not JSON serializable.")


def encode(message):
    """Encode a message as the text of a frame (JSON), or as the bytes of a binary
    frame if it has bytes.

    A binary frame is the length of its header (4 bytes, little-endian), the header
    (JSON, padded with spaces) and the buffers, each padded to 8 bytes. The header
    is ``{"message": ..., "buffers": [[offset, length], ...]}``: the message with
    ``{"$bytes": i}`` in place of the i-th buffer, the offsets from the start of the
    frame.

    Examples
    --------
    >>> encode({"type": "done", "id": 1})
    '{"type": "done", "id": 1}'
    >>> frame = encode({"type": "bytes", "id": 2, "data": b"abc"})
    >>> decode(frame)
    {'type': 'bytes', 'id': 2, 'data': b'abc'}
    """
    buffers = []

    def replace(value):
        if isinstance(value, (bytes, bytearray, memoryview)):
            buffers.append(bytes(value))
            return {"$bytes": len(buffers) - 1}
        if isinstance(value, dict):
            return {key: replace(v) for key, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [replace(v) for v in value]
        return value

    message = replace(message)
    if not buffers:
        return json.dumps(message, default=_numbers)

    def header(offsets):
        text = json.dumps(
            {"message": message, "buffers": offsets}, default=_numbers
        ).encode()
        return text + b" " * _pad(4 + len(text))

    # the offsets depend on the length of the header, which depends on the offsets:
    # place the buffers after a header of the final length
    offsets = [[0, len(b)] for b in buffers]
    while True:
        start = 4 + len(header(offsets))
        new, position = [], start
        for buffer in buffers:
            new.append([position, len(buffer)])
            position += len(buffer) + _pad(len(buffer))
        if new == offsets:
            break
        offsets = new
    text = header(offsets)
    parts = [struct.pack("<I", len(text)), text]
    for buffer in buffers:
        parts += [buffer, b"\0" * _pad(len(buffer))]
    return b"".join(parts)


def decode(data):
    """Decode the text or the bytes of a frame into a message, see :func:`encode`."""
    if isinstance(data, str):
        return json.loads(data)
    data = bytes(data)
    (length,) = struct.unpack_from("<I", data)
    header = json.loads(data[4 : 4 + length])
    buffers = [data[offset : offset + size] for offset, size in header["buffers"]]

    def replace(value):
        if isinstance(value, dict):
            if set(value) == {"$bytes"}:
                return buffers[value["$bytes"]]
            return {key: replace(v) for key, v in value.items()}
        if isinstance(value, list):
            return [replace(v) for v in value]
        return value

    return replace(header["message"])


def safe_name(name):
    """A plain file name, so that a file cannot be written outside of the folder of
    the session, like ``safeName()`` of the app."""
    base = name.replace("\\", "/").split("/")[-1]
    if base in ("", ".", ".."):
        raise ValueError(f"Invalid file name '{name}'.")
    return base


def versions():
    """The versions of the runtime, like those of the Pyodide worker."""
    import felupe
    import numpy
    import scipy

    return {
        "python": sys.version.split()[0],
        "felupe": felupe.__version__,
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
        "felupe_studio": __version__,
        "runtime": "python",
    }


def _scene(meta, surfaces):
    """A scene of results: its label (JSON text) with its surfaces."""
    return {**json.loads(meta), "surfaces": list(surfaces)}


def _write_file(request, send):
    Path(safe_name(request["name"])).write_bytes(request["data"])
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

    _mesh_info(request, send, meshes.load(safe_name(request["name"])))


def _make_mesh(request, send):
    from . import meshes

    parameters = json.dumps(request.get("parameters") or {})
    result = meshes.make_json(
        safe_name(request["file"]), parameters, request.get("item")
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


def _result(request, send):
    from . import results

    meta, surfaces = results.scene(
        request["job"],
        request["substep"],
        request["quantity"],
        request.get("method") or "cells",
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


def _export_mesh(request, send):
    from . import meshes

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
        result = benchmark(n=n, num=5)
        send({"type": "benchmark-result", "id": request["id"], "result": result})
    send({"type": "done", "id": request["id"]})


HANDLERS = {
    "write-file": _write_file,
    "inspect-mesh": _inspect_mesh,
    "make-mesh": _make_mesh,
    "run": _run,
    "script": _script,
    "script-view": _script,
    "result": _result,
    "result-ranges": _result_ranges,
    "export-results": _export_results,
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


def session(connection, folder):
    """The process of a connection of the app: it imports FElupe, says that it is
    ready, works in ``folder`` and answers the requests of ``connection`` (a pipe of
    :mod:`multiprocessing`) until it is closed."""
    start = time.perf_counter()
    os.chdir(folder)
    try:
        import felupe  # noqa: F401
        import meshio  # noqa: F401

        from . import results, runner  # noqa: F401

        ready = {"type": "ready", "versions": versions()}
    except Exception:
        connection.send({"type": "error", "message": traceback.format_exc()})
        return
    total = (time.perf_counter() - start) * 1000
    ready["timings"] = {"pyodide": 0, "packages": 0, "felupe": total, "total": total}
    connection.send(ready)
    while True:
        try:
            request = connection.recv()
        except (EOFError, OSError):
            return
        handle(request, connection.send)
