"""The app with the local Python runtime in a browser (#240, ADR 0014): a sample
opened from felupe-studio serve, solved with CPython, its results shown.

Needs Playwright with Chromium (``pip install playwright && playwright install
chromium``, or ``CHROME`` with the path of a Chrome) and the built app
(``npm run build`` in app/). Run with ``pytest -m e2e``.
"""

import os
import re
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
    assert "Python runs on this computer" in page.inner_text(".welcome")

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


def test_pardiso_of_the_local_python(url, page):
    # the linear solver PARDISO of a job (#308): with pypardiso it solves, without
    # it (e.g. in CI) the job has an issue, and Help ▸ About says so
    try:
        import pypardiso  # noqa: F401
    except ImportError:
        installed = False
    else:
        installed = True
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    card = page.locator(".sample-card").filter(
        has_text="Hyperelastic block with a rigid plate"
    )
    card.get_by_role("button", name="Open").click()
    # the sample, not the empty model before it
    page.get_by_text("17 commands", exact=True).wait_for(timeout=60_000)
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    line = page.get_by_label("Command", exact=True)
    line.fill(
        'job.add {"name": "job_pardiso", "steps": ["shift_and_tilt"], '
        '"solver": {"type": "pardiso"}}'
    )
    line.press("Enter")
    page.get_by_text("Created job_pardiso.").wait_for()
    page.get_by_role("button", name="Help").click()
    page.get_by_role("menuitem", name="About").click()
    about = page.get_by_role("dialog")
    versions = about.get_by_label("Versions").inner_text()
    assert ("PyPardiso\nnot installed" in versions) != installed
    about.get_by_role("button", name="Close").click()
    about.wait_for(state="hidden")
    if installed:
        page.get_by_text("0 issues", exact=True).wait_for()
        page.get_by_role("button", name="Solve").click()
        page.get_by_role("button", name="Show results").wait_for(timeout=120_000)
        assert "PARDISO" in page.locator("body").inner_text()
    else:
        page.get_by_text("1 issue", exact=True).wait_for()
        # the issue at the solver of the job
        page.get_by_role("treeitem", name="job_pardiso").first.click()
        properties = page.get_by_role("region", name="Properties")
        properties.get_by_text("PARDISO needs the package pypardiso").wait_for()
    assert page.errors == []


def test_a_hidden_mesh_is_dimmed_after_another_project(url, page):
    # the row of the point set top of the glued plate is reused for the mesh top of
    # the bushing made with mesh tools, an input of top_plane and hidden: Chromium
    # kept the old style of the row with a rule of its label, its opacity is now
    # inherited from the row (#315)
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    card = page.locator(".sample-card").filter(has_text="rigid plate")
    card.get_by_role("button", name="Open").click()
    page.get_by_text("17 commands", exact=True).wait_for(timeout=60_000)

    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    samples = page.get_by_role("dialog")
    # by its title: the description of the bushing with the Mullins effect names it
    title = page.get_by_role("heading", name="Bushing made with mesh tools", exact=True)
    samples.locator("li").filter(has=title).get_by_role("button", name="Open").click()
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.get_by_text("40 commands", exact=True).wait_for(timeout=60_000)

    tree = page.get_by_role("navigation", name="Model browser")
    for name in ["top", "bottom"]:
        tree.get_by_role("button", name=f"Show {name}", exact=True).wait_for()
        label = tree.get_by_role("treeitem", name=name, exact=True).locator(
            ".tree-label"
        )
        assert label.evaluate("e => getComputedStyle(e).opacity") == "0.45"
    assert page.errors == []


def test_the_range_of_the_rubber_beside_the_steel(url, page):
    # the bushing with steel sleeves (#377): the von Mises stress with the range of
    # the rubber, the steel above it in the outside color, the rubber named at the
    # scalar bar
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    samples = page.get_by_role("dialog")
    title = page.get_by_role(
        "heading", name="Bushing with steel sleeves (FElupe ex05)", exact=True
    )
    samples.locator("li").filter(has=title).get_by_role("button", name="Open").click()
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    results.click()
    contour = page.locator(".results-controls select").filter(
        has=page.locator("option[value=stress_mises]")
    )
    contour.select_option("stress_mises")
    bar = page.locator(".app-scalar-bar .fv-bar-title", has_text="Von Mises")
    bar.wait_for(timeout=60_000)
    ticks = ".app-scalar-bar .fv-ticks span"
    high = page.locator(ticks).last
    steel = float(high.inner_text())

    page.get_by_role("button", name="Contour settings").click()
    popover = page.get_by_role("dialog", name="Contour settings")
    popover.get_by_role("checkbox", name="soft_body").check()
    note = page.locator(".app-scalar-bar .fv-bar-note")
    note.wait_for(timeout=60_000)
    assert note.inner_text() == "Range: soft_body"
    page.wait_for_function(
        f"() => Number([...document.querySelectorAll({ticks!r})].at(-1)"
        f".textContent) < {steel}"
    )
    rubber = float(high.inner_text())
    assert 0 < rubber < 0.6 * steel
    assert page.locator(".app-scalar-bar canvas.scalar-outside.above").count() == 1
    assert page.errors == []
