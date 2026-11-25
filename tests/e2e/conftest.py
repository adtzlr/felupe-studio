"""The fixtures of the end-to-end tests."""

import socket
import subprocess
import sys
import threading
from pathlib import Path

import pytest

DIST = Path(__file__).parents[2] / "app" / "dist"


def drain(stream):
    """Read the output of a server until it exits, and drop it."""
    for _ in stream:
        pass


def stop(server, timeout=10):
    """Stop a server, and kill it if it does not exit in time."""
    server.terminate()
    try:
        server.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()


@pytest.fixture(scope="module")
def serve():
    """Start ``felupe-studio serve`` of the built app on a free port: a function of
    the keyword arguments of :func:`felupe_studio.serve.serve` that returns the port.

    After its first line, the output of a server is read on a thread until it exits.
    A pipe that nobody reads fills up, and then the server blocks on its next log
    line: the tests hung, at last on the shutdown after the last test of a module.
    The servers are stopped after the tests of the module.
    """
    if not (DIST / "index.html").is_file():
        pytest.skip("The app is not built: npm run build in app/.")
    servers = []

    def start(**options):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        arguments = "".join(f", {key}={value!r}" for key, value in options.items())
        code = (
            "from felupe_studio.serve import serve; "
            f"serve(port={port}, app={str(DIST)!r}, browser=False{arguments})"
        )
        server = subprocess.Popen(
            [sys.executable, "-c", code],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        servers.append(server)
        line = server.stdout.readline()
        assert "FElupe Studio runs at" in line, line + server.stdout.read()
        threading.Thread(target=drain, args=(server.stdout,), daemon=True).start()
        return port

    yield start
    for server in servers:
        stop(server)
