"""``felupe-studio serve``: the app with a local Python runtime (#240, ADR 0014).

The server serves the built app on ``127.0.0.1`` and answers its requests over a
WebSocket at ``/runtime``, with the messages of the Pyodide worker. Every connection
gets a Python process of its own (:func:`felupe_studio.runtime.session`) with a
temporary folder; a closed connection ends it, e.g. to cancel a job. The WebSocket
needs the token of the URL that the server prints; it accepts the hosts
``127.0.0.1`` and ``localhost`` only, and WebSockets of its own origin. Needs
``felupe-studio[serve]``.
"""

import asyncio
import multiprocessing
import secrets
import shutil
import tempfile
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import HTMLResponse, PlainTextResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .runtime import decode, encode, session

HOSTS = ["127.0.0.1", "localhost"]
"""The hosts of the server: the loopback interface only (against DNS rebinding)."""

META = '<meta name="felupe-studio-runtime" content="python" />'
"""The tag of the served ``index.html`` that makes the app use the local runtime."""

POLICY = 1008
"""The close code of a WebSocket without the token or of a foreign origin."""


def find_app(app=None):
    """The folder of the built app: the given one, the app of the package or
    ``app/dist`` of a clone (``npm run build``)."""
    here = Path(__file__).parent
    candidates = (
        [Path(app)]
        if app
        else [here / "data" / "app", here.parents[1] / "app" / "dist"]
    )
    for folder in candidates:
        if (folder / "index.html").is_file():
            return folder
    raise FileNotFoundError(
        "The built app is missing: install a release of felupe-studio, or build "
        "the app of a clone with `npm run build` in app/, or give --app."
    )


class Session:
    """A Python process of a connection with a temporary folder."""

    def __init__(self):
        self.folder = tempfile.mkdtemp(prefix="felupe-studio-")
        context = multiprocessing.get_context("spawn")
        self.connection, child = context.Pipe()
        self.process = context.Process(
            target=session, args=(child, self.folder), daemon=True
        )
        self.process.start()
        child.close()

    def close(self):
        """End the process (also a running job) and remove its folder."""
        if self.process.is_alive():
            self.process.kill()
        self.process.join(timeout=5)
        self.connection.close()
        shutil.rmtree(self.folder, ignore_errors=True)


async def _to_app(websocket, connection):
    """Send the messages of the process to the app until the process ends."""
    while True:
        try:
            message = await asyncio.to_thread(connection.recv)
        except (EOFError, OSError):
            return
        frame = encode(message)
        if isinstance(frame, bytes):
            await websocket.send_bytes(frame)
        else:
            await websocket.send_text(frame)


async def _to_process(websocket, connection):
    """Send the requests of the app to the process until the app disconnects."""
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        data = message.get("bytes")
        request = decode(data if data is not None else message["text"])
        # the pipe may be full while the process runs a job
        await asyncio.to_thread(connection.send, request)


def create_app(dist, token):
    """The Starlette app of the server: the built app in ``dist`` and the runtime
    with the ``token``."""
    dist = Path(dist)

    async def index(request):
        html = (dist / "index.html").read_text(encoding="utf-8")
        html = html.replace("</head>", f"    {META}\n  </head>", 1)
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})

    async def runtime(websocket: WebSocket):
        given = websocket.query_params.get("token", "")
        origin = websocket.headers.get("origin")
        own = f"http://{websocket.headers.get('host', '')}"
        if not secrets.compare_digest(given, token) or origin not in (None, own):
            await websocket.close(code=POLICY)
            return
        await websocket.accept()
        process = Session()
        tasks = [
            asyncio.create_task(_to_app(websocket, process.connection)),
            asyncio.create_task(_to_process(websocket, process.connection)),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        except WebSocketDisconnect:
            pass
        finally:
            # also if the connection is cancelled, e.g. at the end of the server:
            # without an await before the process ends
            for task in tasks:
                task.cancel()
            process.close()
            try:
                await websocket.close()
            except (RuntimeError, asyncio.CancelledError):
                pass

    async def not_found(request, exc):
        return PlainTextResponse("Not found.", status_code=404)

    return Starlette(
        routes=[
            Route("/", index),
            Route("/index.html", index),
            WebSocketRoute("/runtime", runtime),
            Mount("/", StaticFiles(directory=dist)),
        ],
        middleware=[Middleware(TrustedHostMiddleware, allowed_hosts=HOSTS)],
        exception_handlers={404: not_found},
    )


def serve(port=8765, app=None, browser=True, token=None):
    """Serve the app with the local runtime on ``127.0.0.1`` until Ctrl+C."""
    import threading
    import time
    import webbrowser

    import uvicorn

    dist = find_app(app)
    token = token or secrets.token_urlsafe(24)
    url = f"http://127.0.0.1:{port}/?token={token}"
    config = uvicorn.Config(
        create_app(dist, token),
        host="127.0.0.1",
        port=port,
        log_level="warning",
        # large meshes and results in one frame, uncompressed on this computer
        ws_max_size=1 << 31,
        ws_per_message_deflate=False,
    )
    server = uvicorn.Server(config)

    def announce():
        while not server.started and not server.should_exit:
            time.sleep(0.05)
        if server.started:
            print(f"FElupe Studio runs at {url}", flush=True)
            print("Press Ctrl+C to stop it.", flush=True)
            if browser:
                webbrowser.open(url)

    threading.Thread(target=announce, daemon=True).start()
    server.run()
