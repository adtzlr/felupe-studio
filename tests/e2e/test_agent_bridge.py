"""An agent on the open app (#258, ADR 0015): felupe-studio serve --agent, a tab
connected with Help ▸ Connect an agent, and the MCP client of the SDK as the agent.
It opens a sample, writes a mesh script that the user runs, builds a parametric
mesh with it, solves with progress and gets the results and a picture of the view.

Needs Playwright with Chromium, the built app and ``felupe-studio[serve,mcp]``. Run
with ``pytest -m e2e``.
"""

import asyncio
import base64
import os
import threading

import pytest

pytestmark = pytest.mark.e2e

sync_api = pytest.importorskip("playwright.sync_api")
pytest.importorskip("uvicorn")
pytest.importorskip("mcp")

import httpx2  # noqa: E402
from mcp import Client  # noqa: E402
from mcp.client.streamable_http import streamable_http_client  # noqa: E402

TOKEN = "agent-e2e-token"
SCRIPT = "import felupe as fem\nmesh = fem.Cube(n=n)\n"


@pytest.fixture(scope="module")
def port(serve):
    return serve(token=TOKEN, agent=True)


def agent(port, steps):
    """Run the steps of an agent (a coroutine function of an MCP client) in a
    thread of its own, beside the event loop of Playwright."""
    box = {}

    async def main():
        headers = {"Authorization": f"Bearer {TOKEN}"}
        async with httpx2.AsyncClient(headers=headers, timeout=300) as http:
            url = f"http://127.0.0.1:{port}/mcp"
            async with Client(streamable_http_client(url, http_client=http)) as c:
                box["value"] = await steps(c)

    def target():
        try:
            asyncio.run(main())
        except BaseException as error:  # noqa: BLE001
            box["error"] = error

    thread = threading.Thread(target=target)
    thread.start()
    return thread, box


def run(port, steps):
    thread, box = agent(port, steps)
    thread.join(300)
    if "error" in box:
        raise box["error"]
    return box["value"]


def answer(result):
    assert not result.is_error, result.content[0].text
    return result.structured_content


def test_an_agent_builds_and_solves_on_the_open_app(port):
    with sync_api.sync_playwright() as playwright:
        chrome = os.environ.get("CHROME")
        browser = playwright.chromium.launch(
            args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
            **({"executable_path": chrome} if chrome else {}),
        )
        page = browser.new_context(viewport={"width": 1280, "height": 800}).new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"http://127.0.0.1:{port}/?token={TOKEN}")
        page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

        # without a connected tab
        missing = run(port, lambda c: c.call_tool("list_commands", {}))
        assert missing.is_error and "No app is connected" in missing.content[0].text

        page.get_by_role("button", name="Help", exact=True).click()
        page.get_by_role("menuitem", name="Connect an agent").click()
        page.get_by_text("Agent connected").wait_for(timeout=10_000)

        opened = run(
            port,
            lambda c: c.call_tool("open_sample", {"sample": "material-test"}),
        )
        assert answer(opened)["errors"] == []
        page.get_by_text("0 issues", exact=True).wait_for(timeout=30_000)

        # a mesh script of the agent runs after the user agrees
        thread, box = agent(
            port,
            lambda c: c.call_tool("write_file", {"name": "cube.py", "content": SCRIPT}),
        )
        consent = page.get_by_role("dialog", name="A Python script of the agent")
        consent.wait_for(timeout=15_000)
        consent.get_by_role("button", name="Show the script").click()
        assert "fem.Cube(n=n)" in consent.inner_text()
        consent.get_by_role("button", name="Run it", exact=True).click()
        thread.join(30)
        assert answer(box["value"]) == {"written": "cube.py", "bytes": len(SCRIPT)}

        # a parametric mesh of the script, an undo step of the open model
        async def parametric(c):
            parameter = {
                "command": "parameter.add",
                "name": "n",
                "value": 3,
                "integer": True,
            }
            script = {"command": "mesh.script", "name": "agent_cube", "file": "cube.py"}
            await c.call_tool("add_command", {"command": parameter})
            return await c.call_tool("add_command", {"command": script})

        added = answer(run(port, parametric))
        assert added["added"] == "agent_cube" and added["errors"] == []
        page.get_by_text("agent_cube", exact=True).first.wait_for(timeout=10_000)
        assert page.get_by_role("button", name="Undo").first.is_enabled()

        async def cleanup_and_solve(c):
            await c.call_tool("delete_command", {"name": "agent_cube"})
            await c.call_tool("delete_command", {"name": "n"})
            progress = []

            async def report(done, total, message):
                progress.append((done, total, message))

            solved = await c.call_tool("solve", {}, progress_callback=report)
            results = await c.call_tool(
                "results", {"job": "job", "quantity": "displacement"}
            )
            shown = await c.call_tool("show", {"view": "results", "job": "job"})
            await asyncio.sleep(1)
            picture = await c.call_tool("picture", {})
            return progress, solved, results, shown, picture

        progress, solved, results, shown, picture = run(port, cleanup_and_solve)
        substeps = answer(solved)["job"]["substeps"]
        assert progress[-1][:2] == (substeps, substeps)
        assert answer(results)["range"][1] > 0
        assert answer(shown)["workspace"] == "results"
        page.get_by_text("Displacement magnitude").wait_for(timeout=30_000)
        image = picture.content[0]
        assert image.type == "image"
        assert base64.b64decode(image.data).startswith(b"\x89PNG")
        assert errors == []
        browser.close()
