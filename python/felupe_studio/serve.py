"""``felupe-studio serve``: the app with a local Python runtime (#240, ADR 0014).

The server serves the built app on ``127.0.0.1`` and answers its requests over a
WebSocket at ``/runtime``, with the messages of the Pyodide worker. Every connection
gets a Python process of its own (:func:`felupe_studio.runtime.session`) with a
temporary folder; a closed connection ends it, e.g. to cancel a job. The WebSocket
needs the token of the URL that the server prints; it accepts the hosts
``127.0.0.1`` and ``localhost`` only, and WebSockets of its own origin. Needs
``felupe-studio[serve]``.

With ``agent=True`` (``--agent``, #258, ADR 0015) the server also offers an MCP
endpoint at ``/mcp`` for AI agents (with the token as ``Authorization: Bearer``,
without a browser origin) and the WebSocket ``/agent``, by which a tab of the app
answers its tools (:mod:`felupe_studio.bridge`, needs ``felupe-studio[mcp]`` too).
"""

import asyncio
import contextlib
import multiprocessing
import secrets
import shutil
import tempfile
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .runtime import decode, encode, session

HOSTS = ["127.0.0.1", "localhost"]
"""The hosts of the server: the loopback interface only (against DNS rebinding)."""

META = '<meta name="felupe-studio-runtime" content="python" />'
"""The tag of the served ``index.html`` that makes the app use the local runtime."""

AGENT_META = '<meta name="felupe-studio-agent" content="on" />'
"""The tag of the served ``index.html`` if the server has the agent bridge."""

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


def find_samples(dist):
    """The folder of the samples of the app: those of the built app, or those of
    the package (the wheel has them once, in ``felupe_studio/data/samples``) or of
    a clone."""
    here = Path(__file__).parent
    for folder in (
        Path(dist) / "samples",
        here / "data" / "samples",
        here.parents[1] / "app" / "public" / "samples",
    ):
        if folder.is_dir():
            return folder
    return None


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


def _allowed(websocket, token):
    """A WebSocket with the token and without a foreign origin."""
    given = websocket.query_params.get("token", "")
    origin = websocket.headers.get("origin")
    own = f"http://{websocket.headers.get('host', '')}"
    return secrets.compare_digest(given, token) and origin in (None, own)


class TokenGuard:
    """The MCP endpoint for agents: with the token as ``Authorization: Bearer``,
    and without the origin of a browser (no website reaches it)."""

    def __init__(self, app, token):
        self.app = app
        self.expected = f"Bearer {token}".encode()

    async def __call__(self, scope, receive, send):
        headers = dict(scope.get("headers", []))
        if b"origin" in headers:
            response = PlainTextResponse("No browser origins.", status_code=403)
        elif not secrets.compare_digest(
            headers.get(b"authorization", b""), self.expected
        ):
            response = JSONResponse(
                {"error": "The token of felupe-studio serve is missing or wrong."},
                status_code=401,
            )
        else:
            return await self.app(scope, receive, send)
        await response(scope, receive, send)


def _agent_routes(token):
    """The MCP endpoint, the WebSocket of the tab and the lifespan of the bridge."""
    from mcp.server.transport_security import TransportSecuritySettings

    from .bridge import VERSION, Bridge, agent_server

    bridge = Bridge()
    server = agent_server(bridge)
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[f"{host}:*" for host in HOSTS] + HOSTS,
        allowed_origins=[],
    )
    app = server.streamable_http_app(
        streamable_http_path="/mcp", transport_security=security
    )
    endpoint = app.routes[0].endpoint

    async def agent(websocket: WebSocket):
        if not _allowed(websocket, token):
            await websocket.close(code=POLICY)
            return
        await websocket.accept()
        try:
            hello = await websocket.receive_json()
        except (WebSocketDisconnect, ValueError):
            return
        if hello.get("type") != "hello" or hello.get("version") != VERSION:
            message = f"The bridge has version {VERSION}: reload the app."
            await websocket.send_json({"type": "refused", "message": message})
            await websocket.close(code=POLICY)
            return
        await bridge.attach(websocket)
        await websocket.send_json({"type": "welcome", "version": VERSION})
        try:
            while True:
                await bridge.answer(websocket, await websocket.receive_json())
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            bridge.detach(websocket)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        async with server.session_manager.run():
            yield

    routes = [
        Route("/mcp", endpoint=TokenGuard(endpoint, token)),
        WebSocketRoute("/agent", agent),
    ]
    return routes, lifespan, bridge


def create_app(dist, token, agent=False):
    """The Starlette app of the server: the built app in ``dist`` and the runtime
    with the ``token``, and with ``agent`` the bridge of the agents (the bridge is
    ``app.state.bridge``)."""
    dist = Path(dist)
    agent_routes, lifespan, bridge = _agent_routes(token) if agent else ([], None, None)
    metas = META + (f"\n    {AGENT_META}" if agent else "")

    async def index(request):
        html = (dist / "index.html").read_text(encoding="utf-8")
        html = html.replace("</head>", f"    {metas}\n  </head>", 1)
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})

    async def runtime(websocket: WebSocket):
        if not _allowed(websocket, token):
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

    samples = find_samples(dist)
    app = Starlette(
        routes=[
            Route("/", index),
            Route("/index.html", index),
            WebSocketRoute("/runtime", runtime),
            *agent_routes,
            *([Mount("/samples", StaticFiles(directory=samples))] if samples else []),
            Mount("/", StaticFiles(directory=dist)),
        ],
        middleware=[Middleware(TrustedHostMiddleware, allowed_hosts=HOSTS)],
        exception_handlers={404: not_found},
        lifespan=lifespan,
    )
    app.state.bridge = bridge
    return app


def serve(port=8765, app=None, browser=True, token=None, agent=False):
    """Serve the app with the local runtime on ``127.0.0.1`` until Ctrl+C; with
    ``agent`` also the MCP endpoint of the agent bridge."""
    import threading
    import time
    import webbrowser

    import uvicorn

    dist = find_app(app)
    token = token or secrets.token_urlsafe(24)
    url = f"http://127.0.0.1:{port}/?token={token}"
    config = uvicorn.Config(
        create_app(dist, token, agent=agent),
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
            if agent:
                endpoint = f"http://127.0.0.1:{port}/mcp"
                print(
                    f"The MCP endpoint for agents: {endpoint}\n"
                    "  Claude Code: claude mcp add --transport http felupe-studio "
                    f'{endpoint} --header "Authorization: Bearer {token}"\n'
                    "  Then connect the app: Help ▸ Connect an agent.",
                    flush=True,
                )
            print("Press Ctrl+C to stop it.", flush=True)
            if browser:
                webbrowser.open(url)

    threading.Thread(target=announce, daemon=True).start()
    server.run()
