"""The app with the local Python runtime in a browser (#240, ADR 0014): a sample
opened from felupe-studio serve, solved with CPython, its results shown.

Needs Playwright with Chromium (``pip install playwright && playwright install
chromium``, or ``CHROME`` with the path of a Chrome) and the built app
(``npm run build`` in app/). Run with ``pytest -m e2e``.
"""

import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

sync_api = pytest.importorskip("playwright.sync_api")
pytest.importorskip("uvicorn")

DIST = Path(__file__).parents[2] / "app" / "dist"
TOKEN = "e2e-token"


@pytest.fixture(scope="module")
def url():
    if not (DIST / "index.html").is_file():
        pytest.skip("The app is not built: npm run build in app/.")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    code = (
        "from felupe_studio.serve import serve; "
        f"serve(port={port}, app={str(DIST)!r}, browser=False, token={TOKEN!r})"
    )
    server = subprocess.Popen(
        [sys.executable, "-c", code],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    line = server.stdout.readline()
    assert "FElupe Studio runs at" in line, line + server.stdout.read()
    yield f"http://127.0.0.1:{port}/?token={TOKEN}"
    server.terminate()
    server.wait()


@pytest.fixture
def page(url):
    with sync_api.sync_playwright() as playwright:
        chrome = os.environ.get("CHROME")
        browser = playwright.chromium.launch(
            # WebGL of the viewer without a GPU
            args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
            **({"executable_path": chrome} if chrome else {}),
        )
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        context.add_init_script(
            "localStorage.setItem('felupe-studio.tip.pick', 'seen')"
        )
        page = context.new_page()
        page.errors = []
        page.on("pageerror", lambda error: page.errors.append(str(error)))
        yield page
        browser.close()


def test_a_sample_solved_with_the_local_python(url, page):
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    # the token is kept for the tab, not in the address
    assert "token" not in page.url
    assert not page.evaluate("navigator.serviceWorker.controller")
    assert "with the Python of this computer" in page.inner_text(".welcome")

    card = page.locator(".sample-card").filter(has_text="Plate with a hole in plane")
    card.get_by_role("button", name="Open").click()
    dialog = page.get_by_role("dialog")
    assert "on this computer with your rights" in dialog.inner_text()
    dialog.get_by_role("button", name="Open", exact=True).click()
    page.get_by_text("13 commands", exact=True).wait_for(timeout=60_000)
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    assert "9 substeps" in page.get_by_text("substeps in").first.inner_text()
    results.click()
    page.wait_for_selector("text=/Displacement magnitude/", timeout=60_000)

    # a reload keeps the session and the runtime
    page.reload()
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    assert page.errors == []
