"""The agent bridge of felupe-studio serve (#258, ADR 0015): the MCP endpoint whose
tools a tab of the app answers."""

import asyncio
import base64
import json
import socket
import threading
import time

import pytest

pytest.importorskip("mcp")
pytest.importorskip("starlette.testclient")

import httpx2  # noqa: E402
import uvicorn  # noqa: E402
from mcp import Client  # noqa: E402
from mcp.client.streamable_http import streamable_http_client  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402
from websockets.sync.client import connect  # noqa: E402

from felupe_studio.bridge import (  # noqa: E402
    GONE,
    NO_APP,
    VERSION,
    Bridge,
    agent_server,
)
from felupe_studio.mcp import DESCRIPTIONS  # noqa: E402
from felupe_studio.serve import AGENT_META, META, create_app  # noqa: E402

TOKEN = "agent-token"
PNG = b"\x89PNG\r\n\x1a\nfake"


class Tab:
    """A tab of the app in a test: it answers the calls of the bridge."""

    def __init__(self, bridge, answers=None):
        self.bridge = bridge
        self.answers = answers or {}
        self.sent = []
        self.closed = False

    async def send_json(self, message):
        self.sent.append(message)
        if message.get("type") == "call":
            asyncio.get_running_loop().create_task(self.reply(message))

    async def close(self):
        self.closed = True

    async def reply(self, call):
        answer = self.answers.get(call["tool"], result({"echo": call["arguments"]}))
        if callable(answer):
            answer = await answer(self, call)
        if answer is not None:
            await self.bridge.answer(self, {**answer, "id": call["id"]})


def result(value):
    return {"type": "result", "result": value}


async def solving(tab, call):
    for done in (1, 2):
        await tab.bridge.answer(
            tab,
            {
                "type": "progress",
                "id": call["id"],
                "progress": done,
                "total": 2,
                "message": f"job: {done} of 2 substeps",
            },
        )
    return result({"job": {"substeps": 2}})


async def tool(client, name, arguments=None, **kwargs):
    return await client.call_tool(name, arguments or {}, **kwargs)


def test_the_tools_act_on_the_tab():
    async def main():
        bridge = Bridge()
        async with Client(agent_server(bridge)) as client:
            tools = {t.name: t for t in (await client.list_tools()).tools}
            assert {
                "schema",
                "add_command",
                "solve",
                "results",
                "selection",
                "select",
                "show",
                "picture",
            } <= set(tools)
            # the descriptions of the MCP server of project folders
            assert tools["add_command"].description.startswith(
                DESCRIPTIONS["add_command"]
            )

            # the schema without an app, the other tools need one
            overview = await tool(client, "schema")
            assert len(overview.structured_content["commands"]) > 20
            missing = await tool(client, "list_commands")
            assert missing.is_error and NO_APP in missing.content[0].text

            picture = base64.b64encode(PNG).decode()
            tab = Tab(
                bridge,
                {
                    "list_commands": result({"commands": [], "errors": []}),
                    "solve": solving,
                    "picture": result({"png": picture}),
                    "delete_command": {"type": "error", "message": "Not 'x'."},
                },
            )
            await bridge.attach(tab)
            listed = await tool(client, "list_commands")
            assert listed.structured_content == {"commands": [], "errors": []}
            # the arguments without the unset ones
            added = await tool(
                client, "add_command", {"command": {"command": "a", "name": "b"}}
            )
            assert added.structured_content == {
                "echo": {"command": {"command": "a", "name": "b"}}
            }
            assert tab.sent[-1]["tool"] == "add_command"

            progress = []

            async def report(done, total, message):
                progress.append((done, total, message))

            solved = await tool(client, "solve", progress_callback=report)
            assert solved.structured_content == {"job": {"substeps": 2}}
            assert progress == [
                (1, 2, "job: 1 of 2 substeps"),
                (2, 2, "job: 2 of 2 substeps"),
            ]

            image = await tool(client, "picture")
            assert image.content[0].type == "image"
            assert base64.b64decode(image.content[0].data) == PNG

            failed = await tool(client, "delete_command", {"name": "x"})
            assert failed.is_error and "Not 'x'." in failed.content[0].text

    asyncio.run(main())


def test_a_new_tab_replaces_the_former():
    async def main():
        bridge = Bridge()
        waiting = Tab(bridge, {"solve": lambda tab, call: asyncio.sleep(0)})
        await bridge.attach(waiting)
        call = asyncio.create_task(bridge.call("solve"))
        await asyncio.sleep(0.01)
        newer = Tab(bridge)
        await bridge.attach(newer)
        with pytest.raises(Exception, match=GONE):
            await call
        assert waiting.sent[-1] == {"type": "replaced"} and waiting.closed
        # an answer of the former tab is ignored, the newer one answers
        await bridge.answer(waiting, {"type": "result", "id": 1, "result": 1})
        assert await bridge.call("selection") == {"echo": {}}
        # a closed tab fails its call
        silent = Tab(bridge, {"solve": lambda tab, call: asyncio.sleep(0)})
        await bridge.attach(silent)
        call = asyncio.create_task(bridge.call("solve"))
        await asyncio.sleep(0.01)
        bridge.detach(silent)
        with pytest.raises(Exception, match=GONE):
            await call
        assert not bridge.connected

    asyncio.run(main())


@pytest.fixture
def dist(tmp_path):
    folder = tmp_path / "dist"
    folder.mkdir()
    (folder / "index.html").write_text("<html><head></head></html>\n")
    return folder


@pytest.fixture
def client(dist):
    app = create_app(dist, TOKEN, agent=True)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        client.bridge = app.state.bridge
        yield client


INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1"},
    },
}
HEADERS = {"accept": "application/json, text/event-stream"}


def test_the_endpoint_needs_the_token(client, dist):
    assert AGENT_META in client.get("/").text
    with TestClient(create_app(dist, TOKEN), base_url="http://127.0.0.1:8765") as c:
        page = c.get("/").text
        assert META in page and AGENT_META not in page
        assert c.post("/mcp", json=INITIALIZE).status_code in (404, 405)

    bearer = {**HEADERS, "authorization": f"Bearer {TOKEN}"}
    assert client.post("/mcp", json=INITIALIZE, headers=HEADERS).status_code == 401
    wrong = {**HEADERS, "authorization": "Bearer wrong"}
    assert client.post("/mcp", json=INITIALIZE, headers=wrong).status_code == 401
    # no website reaches it, and only the hosts of the loopback interface
    browser = {**bearer, "origin": "http://127.0.0.1:8765"}
    assert client.post("/mcp", json=INITIALIZE, headers=browser).status_code == 403
    other = {**bearer, "host": "example.com"}
    assert client.post("/mcp", json=INITIALIZE, headers=other).status_code == 400
    response = client.post("/mcp", json=INITIALIZE, headers=bearer)
    assert response.status_code == 200, response.text


def tab(client, token=TOKEN, origin="http://127.0.0.1:8765"):
    url = f"ws://127.0.0.1:8765/agent?token={token}"
    return client.websocket_connect(url, headers={"origin": origin})


def test_the_websocket_of_the_tab(client):
    for kwargs in ({"token": "wrong"}, {"origin": "https://example.com"}):
        with pytest.raises(WebSocketDisconnect) as error:
            with tab(client, **kwargs) as websocket:
                websocket.receive_json()
        assert error.value.code == 1008
    with tab(client) as websocket:
        websocket.send_json({"type": "hello", "version": VERSION + 1})
        refused = websocket.receive_json()
        assert refused["type"] == "refused" and "reload the app" in refused["message"]

    with tab(client) as first:
        first.send_json({"type": "hello", "version": VERSION})
        assert first.receive_json() == {"type": "welcome", "version": VERSION}
        # a call of an agent, answered by the tab
        call = client.portal.start_task_soon(
            client.bridge.call, "select", {"names": ["a"]}
        )
        request = first.receive_json()
        assert request == {
            "type": "call",
            "id": request["id"],
            "tool": "select",
            "arguments": {"names": ["a"]},
        }
        first.send_json({"type": "result", "id": request["id"], "result": ["a"]})
        assert call.result(timeout=5) == ["a"]
        # a second tab replaces it
        with tab(client) as second:
            second.send_json({"type": "hello", "version": VERSION})
            assert second.receive_json()["type"] == "welcome"
            assert first.receive_json() == {"type": "replaced"}
    for _ in range(50):
        if not client.bridge.connected:
            break
        time.sleep(0.02)
    assert not client.bridge.connected


def test_an_agent_and_a_tab_over_the_network(dist):
    # a real server: the MCP client of the SDK over HTTP, a tab over a WebSocket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    config = uvicorn.Config(
        create_app(dist, TOKEN, agent=True), host="127.0.0.1", port=port
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)

    def answer():
        origin = f"http://127.0.0.1:{port}"
        url = f"ws://127.0.0.1:{port}/agent?token={TOKEN}"
        with connect(url, origin=origin) as websocket:
            websocket.send(json.dumps({"type": "hello", "version": VERSION}))
            json.loads(websocket.recv())
            ready.set()
            call = json.loads(websocket.recv())
            commands = {"commands": [{"command": "model.settings", "name": "s"}]}
            websocket.send(
                json.dumps({"type": "result", "id": call["id"], "result": commands})
            )
            done.wait(10)

    ready, done = threading.Event(), threading.Event()
    app = threading.Thread(target=answer, daemon=True)
    app.start()
    assert ready.wait(10)

    async def main():
        headers = {"Authorization": f"Bearer {TOKEN}"}
        async with httpx2.AsyncClient(headers=headers) as http:
            transport = streamable_http_client(
                f"http://127.0.0.1:{port}/mcp", http_client=http
            )
            async with Client(transport) as client:
                listed = await client.call_tool("list_commands", {})
                assert listed.structured_content["commands"][0]["name"] == "s"

    try:
        asyncio.run(main())
    finally:
        done.set()
        app.join(5)
        server.should_exit = True
        thread.join(5)
