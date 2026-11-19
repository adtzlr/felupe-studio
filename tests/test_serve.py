"""The local Python runtime: felupe-studio serve (#240, ADR 0014)."""

import json
import struct
import time
from pathlib import Path

import numpy as np
import pytest

from felupe_studio.runtime import decode, encode, safe_name

pytest.importorskip("starlette.testclient")

from starlette.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from felupe_studio.cli import main  # noqa: E402
from felupe_studio.serve import (  # noqa: E402
    META,
    agent_message,
    create_app,
    find_app,
    token_of,
)

GOLDEN = Path(__file__).parent / "golden" / "cube_yeoh"
DOCUMENT = (GOLDEN / "commands.json").read_text(encoding="utf-8")
MESH = (GOLDEN / "cube.vtu").read_bytes()
TOKEN = "secret-token"
ORIGIN = "http://127.0.0.1:8765"


def test_frames():
    # a message without bytes is a text frame
    assert encode({"type": "text", "id": 1, "text": "x"}) == (
        '{"type": "text", "id": 1, "text": "x"}'
    )
    # with bytes a binary frame, its header and buffers aligned to 8 bytes
    message = {
        "type": "mesh-info",
        "id": 2,
        "info": {"points": np.int64(8)},
        "surfaces": {
            "hexahedron": {
                "positions": np.zeros(9, dtype=np.float32).tobytes(),
                "faces": None,
                "tags": {"part": np.arange(3, dtype=np.int32).tobytes()},
                "nodes": np.ones(3).tobytes(),
                "cells": 1,
            }
        },
        "list": [b"a", [b"bc"]],
    }
    frame = encode(message)
    (length,) = struct.unpack_from("<I", frame)
    header = json.loads(frame[4 : 4 + length])
    assert (4 + length) % 8 == 0
    assert [offset % 8 for offset, _ in header["buffers"]] == [0] * 5
    assert header["message"]["surfaces"]["hexahedron"]["positions"] == {"$bytes": 0}
    decoded = decode(frame)
    assert decoded["info"] == {"points": 8}
    assert decoded["list"] == [b"a", [b"bc"]]
    assert decoded["surfaces"] == message["surfaces"]
    nodes = decoded["surfaces"]["hexahedron"]["nodes"]
    assert np.frombuffer(nodes).tolist() == [1, 1, 1]


FRAMES = Path(__file__).parent / "data" / "frames"


def shared_message():
    """The message of the frames shared with the app (frames.test.ts)."""
    return {
        "type": "mesh-info",
        "id": 7,
        "info": {"file": "würfel.vtu", "points": 8},
        "surfaces": {
            "hexahedron": {
                "positions": np.array([0, 1, 2.5], dtype=np.float32).tobytes(),
                "nodes": np.array([1.5, -2]).tobytes(),
                "tags": {"part": np.array([1, 2, 3], dtype=np.int32).tobytes()},
                "faces": None,
                "cells": 1,
            }
        },
    }


def test_frames_shared_with_the_app():
    # the frame of Python, which the app decodes, and the frame of the app
    frame = encode(shared_message())
    assert (FRAMES / "python.bin").read_bytes() == frame, (
        "Write tests/data/frames/python.bin again with encode(shared_message())."
    )
    assert decode((FRAMES / "app.bin").read_bytes()) == shared_message()


def test_safe_names():
    assert safe_name("a/b\\cube.vtu") == "cube.vtu"
    for name in ("", "a/..", "."):
        with pytest.raises(ValueError, match="Invalid file name"):
            safe_name(name)


@pytest.fixture
def dist(tmp_path):
    folder = tmp_path / "dist"
    (folder / "assets").mkdir(parents=True)
    (folder / "index.html").write_text(
        "<html>\n  <head>\n    <title>FElupe Studio</title>\n  </head>\n</html>\n"
    )
    (folder / "assets" / "main.js").write_text("console.log('app');\n")
    return folder


@pytest.fixture
def client(dist):
    with TestClient(create_app(dist, TOKEN), base_url=ORIGIN) as client:
        yield client


def connect(client, token=TOKEN, origin=ORIGIN):
    headers = {"origin": origin} if origin else {}
    url = f"ws://127.0.0.1:8765/runtime?token={token}"
    return client.websocket_connect(url, headers=headers)


def receive(websocket):
    message = websocket.receive()
    data = message.get("bytes")
    return decode(data if data is not None else message["text"])


def test_the_app_is_served(client):
    for path in ("/", "/index.html"):
        response = client.get(path)
        assert response.status_code == 200 and META in response.text
        assert response.headers["cache-control"] == "no-store"
    assert client.get("/assets/main.js").text == "console.log('app');\n"
    # the samples of the package, if the app has none (the app of the wheel)
    model = client.get("/samples/plate-with-hole/model.felupe.json")
    assert model.status_code == 200 and "commands" in model.json()
    assert client.get("/missing.js").status_code == 404
    # only the hosts of the loopback interface (against DNS rebinding)
    other = client.get("/", headers={"host": "example.com"})
    assert other.status_code == 400


def test_the_runtime_needs_the_token_and_its_origin(client):
    for kwargs in (
        {"token": ""},
        {"token": "wrong"},
        {"origin": "https://example.com"},
        {"origin": "http://localhost:9999"},
    ):
        with pytest.raises(WebSocketDisconnect) as error:
            with connect(client, **kwargs) as websocket:
                websocket.receive_text()
        assert error.value.code == 1008
    # a foreign host is refused before the WebSocket
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect(f"ws://example.com/runtime?token={TOKEN}"):
            pass
    assert error.value.status_code == 400


def test_a_session(client):
    with connect(client) as websocket:
        ready = receive(websocket)
        assert ready["type"] == "ready"
        assert ready["versions"]["runtime"] == "python"
        assert ready["versions"]["felupe_studio"]
        file = {"type": "write-file", "id": 1, "name": "cube.vtu", "data": MESH}
        websocket.send_bytes(encode(file))
        assert receive(websocket) == {"type": "done", "id": 1}
        websocket.send_text(
            encode({"type": "inspect-mesh", "id": 2, "name": "cube.vtu"})
        )
        info = receive(websocket)
        assert info["type"] == "mesh-info"
        assert isinstance(info["surfaces"]["hexahedron"]["triangles"], bytes)
        websocket.send_text(encode({"type": "run", "id": 3, "document": DOCUMENT}))
        messages = [receive(websocket)]
        while messages[-1]["type"] not in ("job-result", "error"):
            messages.append(receive(websocket))
        assert messages[-1]["type"] == "job-result"
    # a session without a client (no origin) works too, with its own folder
    with connect(client, origin=None) as websocket:
        assert receive(websocket)["type"] == "ready"
        websocket.send_text(
            encode({"type": "inspect-mesh", "id": 1, "name": "cube.vtu"})
        )
        info = receive(websocket)
        assert info["type"] == "mesh-info" and "error" in info["info"]


def test_cancel_ends_the_process(client, monkeypatch):
    # a long job: a closed connection ends its process, and its folder is removed
    import felupe_studio.serve as serve

    sessions = []
    original = serve.Session

    class Recorded(original):
        def __init__(self):
            super().__init__()
            sessions.append(self)

    monkeypatch.setattr(serve, "Session", Recorded)
    long = json.loads(DOCUMENT)
    long["commands"][5]["ramp"]["num"] = 10000
    with connect(client) as websocket:
        receive(websocket)
        file = {"type": "write-file", "id": 1, "name": "cube.vtu", "data": MESH}
        websocket.send_bytes(encode(file))
        receive(websocket)
        websocket.send_text(
            encode({"type": "run", "id": 2, "document": json.dumps(long)})
        )
        while receive(websocket)["event"]["event"] != "substep":
            pass
    [session] = sessions
    for _ in range(100):
        if not session.process.is_alive():
            break
        time.sleep(0.05)
    assert not session.process.is_alive()
    assert not Path(session.folder).exists()


def test_the_built_app_is_found(dist, tmp_path):
    assert find_app(dist) == dist
    with pytest.raises(FileNotFoundError, match="npm run build"):
        find_app(tmp_path / "nothing")


def test_the_command(capsys):
    with pytest.raises(SystemExit) as error:
        main(["--version"])
    assert error.value.code == 0
    with pytest.raises(SystemExit, match="npm run build"):
        main(["serve", "--app", "/nonexistent", "--no-browser"])


def test_the_token_of_the_environment():
    """A token that stays the same at every start, e.g. for a .mcp.json."""
    assert token_of({"FELUPE_STUDIO_TOKEN": "my-token_of-the-user"}) == (
        "my-token_of-the-user"
    )
    assert token_of({}) != token_of({})
    assert token_of({"FELUPE_STUDIO_TOKEN": ""}) != ""
    for token in ("too-short", "a token with spaces", "ümlaut-token-1234567"):
        with pytest.raises(ValueError, match="FELUPE_STUDIO_TOKEN needs at least"):
            token_of({"FELUPE_STUDIO_TOKEN": token})


def test_the_message_of_the_agent_endpoint():
    endpoint = "http://127.0.0.1:8765/mcp"
    fixed = agent_message(endpoint, "my-token_of-the-user", fixed=True)
    assert '"Authorization": "Bearer ${FELUPE_STUDIO_TOKEN}"' in fixed
    assert "my-token_of-the-user" not in fixed
    new = agent_message(endpoint, "abc", fixed=False)
    assert '--header "Authorization: Bearer abc"' in new
    assert "set FELUPE_STUDIO_TOKEN to keep one" in new


def test_the_command_refuses_a_weak_token(dist, monkeypatch):
    monkeypatch.setenv("FELUPE_STUDIO_TOKEN", "1234")
    with pytest.raises(SystemExit, match="FELUPE_STUDIO_TOKEN needs at least 16"):
        main(["serve", "--app", str(dist), "--no-browser"])
