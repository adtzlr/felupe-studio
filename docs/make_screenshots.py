"""Make the screenshots of the user guide and the README from the samples.

Build the app first (``cd app && npm run build``), then run from the repository
root::

    pip install playwright pillow
    playwright install chromium
    python docs/make_screenshots.py

The script serves ``app/dist``, opens the sample *Hyperelastic block with a rigid
plate*, solves it with Python in the browser (the first start downloads Pyodide) and
writes small PNGs to ``docs/images``: the model, the results and a pressure on a face
set. Then it opens three samples of version 0.4: the parameters of the sandwich
spring (the dialog when it is opened), the results of the plate with a hole (a 2D
model) and of the spring with end stops (contact), two of version 0.5: the engine
mount (FElupe ex07, air as a third medium) with the stresses at the points and the
elastic-plastic plate with a hole (the equivalent plastic strain), and one of
version 0.6: the expressions of the step of the sandwich spring.

The app loads Pyodide and its packages from the CDN (cdn.jsdelivr.net): the script
needs it, a stub of the runtime would not show the real versions and load times.
``--pyodide <folder>`` serves them from a folder instead, e.g. ``pyodide/`` of the
release ``pyodide-<version>.tar.bz2`` of Pyodide on GitHub (the version of
``app/package.json``; numpy, scipy, rich and libopenblas are enough), if the CDN is
not reachable.

With ``felupe-studio[serve,mcp]`` installed, it also makes the picture of an agent
on the open app (``felupe-studio serve --agent``, version 0.6): the agent opened a
sample and wrote a mesh script, which the user reads before it runs.
"""

import argparse
import functools
import http.server
import re
import threading
from pathlib import Path

ROOT = Path(__file__).parent.parent
SAMPLE = "Hyperelastic block with a rigid plate"
SIZE = {"width": 1280, "height": 800}


def shrink(path):
    """Reduce a PNG to 256 colors (if Pillow is installed): the dark UI has few."""
    try:
        from PIL import Image
    except ImportError:
        return
    with Image.open(path) as image:
        small = image.convert("RGB").quantize(colors=256, method=Image.FASTOCTREE)
    small.save(path, optimize=True)


def capture(context, url, out):
    """Open the app at ``url`` in a browser context and write the screenshots."""
    out.mkdir(parents=True, exist_ok=True)
    # without the tip about picking of the first visit
    context.add_init_script("localStorage.setItem('felupe-studio.tip.pick', 'seen')")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def shot(name):
        page.wait_for_timeout(800)
        path = out / f"{name}.png"
        page.screenshot(path=str(path))
        shrink(path)
        name = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
        print(f"{name}: {path.stat().st_size // 1024} kB")

    page.goto(url)
    page.wait_for_selector("text=/FElupe [0-9.]+ ready/", timeout=300_000)
    welcome = page.get_by_role("region", name="Welcome to FElupe Studio")
    sample = welcome.locator("li", has_text=SAMPLE)
    sample.get_by_role("button", name="Open").click()
    page.wait_for_selector("text=glued-plate.felupe.zip")

    # the model with the multi-point constraint of the plate selected
    browser = page.get_by_role("navigation", name="Model browser")
    browser.get_by_text("glue", exact=True).click()
    shot("model")

    # the results: von Mises stress with its minimum and maximum, and the curve
    page.keyboard.press("Escape")
    page.get_by_role("button", name="Solve").first.click()
    page.get_by_role("button", name="Show results").click(timeout=300_000)
    page.wait_for_timeout(1500)
    page.locator(".results-controls select").first.select_option("stress_mises")
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Min/Max").click()
    page.get_by_role("button", name="Points", exact=True).click()
    shot("results")

    # a face set of the top face and a pressure on it
    page.get_by_role("button", name="Model", exact=True).click()
    page.keyboard.press("Escape")
    page.keyboard.press("1")  # the default view
    canvas = page.locator("canvas.fv-gl").first.bounding_box()
    x, y = canvas["x"] + canvas["width"] * 0.55, canvas["y"] + canvas["height"] * 0.42
    page.mouse.click(x, y)
    page.get_by_role("button", name="Create face set").click()
    page.get_by_role("dialog").get_by_role("button", name="Create").click()
    page.get_by_role("tab", name="Loads & BCs").click()
    page.get_by_role("button", name=re.compile("^Pressure")).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox", name=re.compile("^Pressure")).fill("0.1")
    dialog.get_by_role("button", name="Create").click()
    shot("pressure")

    def open_sample(title, file):
        """Open a sample from File ▸ Samples…, replacing the current model (after
        asking, if it has changes); a sample with parameters asks for them first."""
        page.keyboard.press("Escape")
        page.get_by_role("button", name="File", exact=True).click()
        page.get_by_role("menuitem", name="Samples…").click()
        card = page.get_by_role("dialog").locator("li", has_text=title)
        card.get_by_role("button", name="Open").click()
        confirm = page.get_by_role("dialog", name="Open project")
        parameters = page.get_by_role("dialog", name=re.compile("^Parameters"))
        opened = page.get_by_text(file, exact=True)
        confirm.or_(parameters).or_(opened).first.wait_for()
        if confirm.is_visible():
            confirm.get_by_role("button", name="Open", exact=True).click()

    def solve(substep=None, quantity=None, job=None):
        """Solve the model and show the results of a substep (default the last) of a
        job (default the one that is shown first)."""
        # from the Model workspace, whose job panel offers the results
        page.get_by_role("button", name="Model", exact=True).click()
        page.get_by_role("button", name="Solve").first.click()
        page.get_by_role("button", name="Show results").click(timeout=300_000)
        page.wait_for_timeout(1500)
        controls = page.locator(".results-controls")

        def field(name):
            """The select of a field of the results, by its label."""
            label = controls.locator("label.field")
            return label.filter(has=page.get_by_text(name, exact=True)).locator(
                "select"
            )

        if job:
            field("Job").select_option(job)
        if quantity:
            field("Contour").select_option(quantity)
        if substep:
            controls.locator(".substep input").fill(str(substep))
        page.wait_for_timeout(1500)

    # the parameters of the sandwich spring when it is opened, then its model
    open_sample("Sandwich spring with parameters", "sandwich-spring.felupe.zip")
    dialog = page.get_by_role("dialog", name=re.compile("^Parameters"))
    dialog.locator("#parameter-layers").fill("4")
    page.set_viewport_size({**SIZE, "height": 960})  # the whole dialog
    shot("parameters")
    page.set_viewport_size(SIZE)
    dialog.get_by_role("button", name="Open", exact=True).click()
    page.wait_for_selector("text=sandwich-spring.felupe.zip")

    # a 2D model: the largest principal stress at the hole of the plate
    open_sample("Plate with a hole in plane strain", "plate-with-hole.felupe.zip")
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.wait_for_selector("text=plate-with-hole.felupe.zip")
    solve(quantity="stress_max")
    page.get_by_label("Curve", exact=True).set_checked(False)  # the whole plate
    shot("plane-strain")

    # contact: the spring with end stops at the end of its compression
    open_sample("Hyperelastic spring with end stops", "hyperelastic-spring.felupe.zip")
    page.wait_for_selector("text=hyperelastic-spring.felupe.zip")
    solve(substep=5, quantity="strain_max")
    page.get_by_label("Curve", exact=True).set_checked(True)
    extremes = page.get_by_role("button", name="Min/Max")
    if extremes.get_attribute("aria-pressed") == "true":
        extremes.click()  # the plates in the middle without labels
    shot("contact")

    # v0.5: the engine mount (ex07) in plane strain, with air as a third medium in
    # its cavities, at the end of the horizontal shift by 8 mm (substep 1 is the
    # start); the von Mises stress at the points, the means of the cells (a smooth
    # contour without the undershoots of a projection next to the soft air)
    open_sample("Engine mount (FElupe ex07)", "engine-mount.felupe.zip")
    page.wait_for_selector("text=engine-mount.felupe.zip")
    solve(substep=9, quantity="stress_mises", job="horizontal")
    page.get_by_role("button", name="Contour settings").click()
    page.get_by_role("dialog", name="Contour settings").get_by_label(
        "Values at"
    ).select_option("mean")
    page.keyboard.press("Escape")
    page.get_by_label("Curve", exact=True).set_checked(True)
    shot("engine-mount")

    # v0.6: the expressions of the parameters in the step of the sandwich spring: the
    # shear is half of the height of the soft layers, the increments two per cell
    open_sample("Sandwich spring with parameters", "sandwich-spring.felupe.zip")
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.wait_for_selector("text=sandwich-spring.felupe.zip")
    page.get_by_role("button", name="Model", exact=True).click()
    browser = page.get_by_role("navigation", name="Model browser")
    browser.get_by_text("shearing", exact=True).click()
    page.get_by_text("= 12 mm").first.wait_for()
    shot("expressions")

    # v0.5: plasticity, the elastic-plastic plate with a hole back at the start: the
    # equivalent plastic strain and the curve of the loading and the unloading
    open_sample("Elastic-plastic plate with a hole", "plastic-plate.felupe.zip")
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.wait_for_selector("text=plastic-plate.felupe.zip")
    solve(quantity="plastic_strain")
    page.get_by_role("button", name="Contour settings").click()
    page.get_by_role("dialog", name="Contour settings").get_by_label(
        "Values at"
    ).select_option("cells")
    page.keyboard.press("Escape")
    page.get_by_label("Curve", exact=True).set_checked(True)
    shot("plasticity")

    if errors:
        raise RuntimeError(f"Errors of the page: {errors}")


def capture_agent(browser, dist, out, port):
    """An agent on the open app (v0.6): ``felupe-studio serve --agent`` with the
    built app, a tab connected by *Help ▸ Connect an agent*, and an MCP client as the
    agent, which opens a sample and writes a mesh script; the picture shows the
    script that the user reads before it runs."""
    try:
        import asyncio
        import subprocess
        import sys

        import httpx2
        from mcp import Client
        from mcp.client.streamable_http import streamable_http_client
    except ImportError:
        print("agent.png: skipped, needs felupe-studio[serve,mcp]")
        return

    token = "screenshot-token"
    code = (
        "from felupe_studio.serve import serve; "
        f"serve(port={port}, app={str(dist)!r}, browser=False, token={token!r}, "
        "agent=True)"
    )
    # the log of the server (e.g. the disconnect of the tab at the end) is not needed
    server = subprocess.Popen(
        [sys.executable, "-c", code],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    script = (
        '"""A block of the hyperelastic block sample, n cells per edge."""\n'
        "import felupe as fem\n\n"
        "mesh = fem.Cube(b=(40, 40, 20), n=(n + 1, n + 1, n // 2 + 1))\n"
    )

    async def steps():
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx2.AsyncClient(headers=headers, timeout=300) as http:
            url = f"http://127.0.0.1:{port}/mcp"
            async with Client(streamable_http_client(url, http_client=http)) as c:
                await c.call_tool("open_sample", {"sample": "glued-plate"})
                parameter = {
                    "command": "parameter.add",
                    "name": "n",
                    "value": 8,
                    "integer": True,
                    "description": "Cells per edge of the block",
                }
                await c.call_tool("add_command", {"command": parameter})
                args = {"name": "block.py", "content": script}
                await c.call_tool("write_file", args)

    try:
        assert "FElupe Studio runs at" in server.stdout.readline()
        context = browser.new_context(viewport=SIZE)
        context.add_init_script(
            "localStorage.setItem('felupe-studio.tip.pick', 'seen')"
        )
        page = context.new_page()
        page.goto(f"http://127.0.0.1:{port}/?token={token}")
        page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
        page.get_by_role("button", name="Help", exact=True).click()
        page.get_by_role("menuitem", name="Connect an agent").click()
        page.get_by_text("Agent connected").wait_for(timeout=10_000)

        # the agent waits for the user, so it runs beside Playwright
        thread = threading.Thread(target=lambda: asyncio.run(steps()))
        thread.start()
        consent = page.get_by_role("dialog", name="A mesh script of the agent")
        consent.wait_for(timeout=60_000)
        consent.get_by_role("button", name="Show the script").click()
        page.wait_for_timeout(800)
        path = out / "agent.png"
        page.screenshot(path=str(path))
        shrink(path)
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size // 1024} kB")
        consent.get_by_role("button", name="Run it", exact=True).click()
        thread.join(60)
        context.close()
    finally:
        server.terminate()
        server.wait()


def route_pyodide(context, folder):
    """Serve the files of Pyodide of the CDN from a folder."""
    types = {
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
    }

    def fulfill(route):
        name = route.request.url.split("/full/")[1].split("?")[0]
        path = folder / name
        if not path.is_file():
            return route.fulfill(status=404)
        route.fulfill(
            body=path.read_bytes(),
            headers={
                "content-type": types.get(path.suffix, "application/octet-stream"),
                "access-control-allow-origin": "*",
            },
        )

    context.route("https://cdn.jsdelivr.net/pyodide/**", fulfill)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dist", type=Path, default=ROOT / "app" / "dist")
    parser.add_argument("--out", type=Path, default=ROOT / "docs" / "images")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--pyodide", type=Path, help="a folder with the files of Pyodide of the CDN"
    )
    args = parser.parse_args()

    from playwright.sync_api import sync_playwright

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

    handler = functools.partial(Quiet, directory=str(args.dist))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            # WebGL without a GPU
            browser = playwright.chromium.launch(
                args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
            )
            context = browser.new_context(viewport=SIZE, service_workers="block")
            if args.pyodide:
                route_pyodide(context, args.pyodide)
            capture(context, f"http://127.0.0.1:{args.port}/index.html", args.out)
            capture_agent(browser, args.dist, args.out, args.port + 1)
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
