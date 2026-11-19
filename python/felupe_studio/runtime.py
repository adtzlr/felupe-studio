"""The Python side of the app in a process of its own: the local runtime of
``felupe-studio serve`` (#240, ADR 0014).

The app talks to it with the messages of its Pyodide worker
(``app/src/worker/protocol.ts``, ADR 0005), which both runtimes answer with the
requests of :mod:`.requests`. :func:`session` is a process of a connection of the
app: it works in a folder of its own, holds the state of the results and ends with
the connection. :func:`encode` and :func:`decode` (:mod:`.frames`) turn the
messages into the frames of the WebSocket.
"""

import os
import sys
import time
import traceback

from .__about__ import __version__
from .frames import decode, encode
from .requests import HANDLERS, handle, safe_name

__all__ = ["HANDLERS", "decode", "encode", "handle", "safe_name", "session", "versions"]


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

        # the linear solvers of this Python, e.g. PARDISO (#308)
        from .capabilities import capabilities

        ready = {
            "type": "ready",
            "versions": versions(),
            "capabilities": capabilities(),
        }
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
