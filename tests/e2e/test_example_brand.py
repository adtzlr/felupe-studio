"""The example brand (brands/example, #321, ADR 0020) in a browser without internet:
its name, its manifest and its own samples, solved with the self-hosted Pyodide,
which the service worker keeps for the next visit.

Needs the build of the brand, e.g. in app/:

    BRAND_DIR=../brands/example npm run build -- --outDir dist-example

and runs with ``BRAND_DIST=app/dist-example pytest -m e2e
tests/e2e/test_example_brand.py``, with Playwright and Chromium (``CHROME`` with the
path of another Chrome). Without ``BRAND_DIST`` it is skipped. Chromium resolves no
host but 127.0.0.1, like a computer of an intranet without internet access.
"""

import functools
import json
import os
import re
import sys
import threading
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import pytest

from felupe_studio import samples

pytestmark = pytest.mark.e2e

sync_api = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).parents[2]
BRAND = json.loads((ROOT / "brands" / "example" / "brand.json").read_text())
SAMPLES = samples.read(ROOT / "brands" / "example" / "samples")
PACKAGE = json.loads((ROOT / "app" / "package.json").read_text())
PYODIDE = f"/pyodide/v{PACKAGE['devDependencies']['pyodide']}/"
READY = re.compile(r"^FElupe [\d.]+ ready \(")


class Handler(SimpleHTTPRequestHandler):
    """A static server, like the Pages of GitLab, that records the paths it serves."""

    def do_GET(self):
        self.server.paths.append(self.path)
        super().do_GET()

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # the browser drops connections it no longer needs, e.g. on a reload
        if not isinstance(sys.exc_info()[1], ConnectionError):
            super().handle_error(request, client_address)


@pytest.fixture(scope="module")
def site():
    dist = os.environ.get("BRAND_DIST")
    if not dist:
        pytest.skip("BRAND_DIST is not set: build the example brand first.")
    dist = Path(dist).resolve()
    page = (dist / "index.html").read_text()
    assert f'"name":"{BRAND["name"]}"' in page, f"{dist} is no build of the brand"
    server = Server(("127.0.0.1", 0), functools.partial(Handler, directory=str(dist)))
    server.paths = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def url(server, path=""):
    return f"http://127.0.0.1:{server.server_port}/{path}"


@pytest.fixture
def page(site):
    with sync_api.sync_playwright() as playwright:
        chrome = os.environ.get("CHROME")
        browser = playwright.chromium.launch(
            args=[
                # no internet: every host but the server fails to resolve
                "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
                # WebGL of the viewer without a GPU
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
            ],
            **({"executable_path": chrome} if chrome else {}),
        )
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        context.add_init_script(
            f"localStorage.setItem('{BRAND['storage']}.tip.pick', 'seen')"
        )
        page = context.new_page()
        page.errors = []
        page.on("pageerror", lambda error: page.errors.append(str(error)))
        page.requests = []
        context.on("request", lambda request: page.requests.append(request.url))
        yield page
        browser.close()


def test_the_files_of_the_brand(site):
    "The manifest, the logo, the samples and Pyodide are files of the build."
    with urllib.request.urlopen(url(site, "manifest.webmanifest")) as response:
        manifest = json.loads(response.read())
    assert manifest["name"] == BRAND["name"]
    assert manifest["short_name"] == BRAND["short_name"]
    assert manifest["theme_color"] == "#171a21"
    assert [icon["sizes"] for icon in manifest["icons"]] == [
        "any",
        "192x192",
        "512x512",
    ]
    for icon in manifest["icons"]:
        with urllib.request.urlopen(url(site, icon["src"])) as response:
            assert response.status == 200
    with urllib.request.urlopen(url(site, "samples/index.json")) as response:
        listed = json.loads(response.read())
    assert [s["id"] for s in listed] == [s.id for s in SAMPLES]
    for name in ("pyodide.mjs", "pyodide.asm.wasm", "pyodide-lock.json"):
        with urllib.request.urlopen(url(site, PYODIDE[1:] + name)) as response:
            assert response.status == 200


def test_a_sample_of_the_brand_solved_without_internet(site, page):
    site.paths.clear()
    page.goto(url(site))
    assert page.title() == BRAND["name"]
    page.get_by_text(READY).wait_for(timeout=120_000)

    # the welcome panel of the brand, with its samples only
    welcome = page.get_by_role("region", name=f"Welcome to {BRAND['name']}")
    assert BRAND["welcome"] in welcome.inner_text()
    titles = [s.title for s in SAMPLES]
    cards = welcome.locator(".sample-card")
    assert cards.locator("h3").all_inner_texts() == titles

    # and in File ▸ Samples…
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    dialog = page.get_by_role("dialog")
    listed = dialog.get_by_role("list", name="Samples").locator("h3")
    assert listed.all_inner_texts() == titles
    dialog.get_by_role("button", name="Close").click()
    dialog.wait_for(state="hidden")

    card = cards.filter(has_text="Rubber strip in shear")
    card.get_by_role("button", name="Open").click()
    page.get_by_text("12 commands", exact=True).wait_for(timeout=60_000)
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    page.get_by_role("button", name="Solve").click()
    page.get_by_role("button", name="Show results").wait_for(timeout=120_000)
    assert "7 substeps" in page.get_by_text("substeps in").first.inner_text()

    # Pyodide and its packages came from the app, nothing from another host
    hosts = {urlparse(request).hostname for request in page.requests}
    assert hosts == {"127.0.0.1"}, hosts
    served = [path for path in site.paths if path.startswith(PYODIDE)]
    assert any("scipy" in path for path in served), served
    assert page.evaluate("navigator.serviceWorker.controller.scriptURL").endswith(
        f"sw.js?storage={BRAND['storage']}"
    )

    # the next visit loads Pyodide and the wheels from the cache of the service worker
    site.paths.clear()
    page.reload()
    page.get_by_text(READY).wait_for(timeout=120_000)
    runtime = [p for p in site.paths if p.startswith((PYODIDE, "/wheels/"))]
    assert runtime == [], runtime
    assert page.errors == []
