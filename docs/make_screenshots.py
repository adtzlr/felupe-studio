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
elastic-plastic plate with a hole (the equivalent plastic strain), one of version
0.6: the expressions of the step of the sandwich spring, two of version 0.7: the
bushing made with the mesh tools, its revolved mesh with the tools in the browser
and its section in the xy-plane, one of version 0.8: the bushing with the
Mullins effect after its first load cycle, and three of version 0.9: the range of
the contour of the rubber of the bushing with steel sleeves, and the same in the
light theme, for a report, with the own colors of its sections.

A second browser context of a phone in portrait (390 × 844) makes the picture of the
compact layout of version 0.9: the model and the results with the curve, side by
side (``phone.png``, needs Pillow).

The app loads Pyodide and its packages from the CDN (cdn.jsdelivr.net): the script
needs it, a stub of the runtime would not show the real versions and load times.
``--pyodide <folder>`` serves them from a folder instead, e.g. ``pyodide/`` of the
release ``pyodide-<version>.tar.bz2`` of Pyodide on GitHub (the version of
``app/package.json``; numpy, scipy, rich and libopenblas are enough), if the CDN is
not reachable.

With ``felupe-studio[serve,mcp]`` installed, it also makes the picture of an agent
on the open app (``felupe-studio serve --agent``, version 0.6): the agent opened a
sample and wrote a mesh script, which the user reads before it runs.

``--theme light`` makes them in the light theme (#375), e.g. into another folder with
``--out``; the default is the dark theme, the default of the app. ``CHROME`` is the
path of another Chrome, like for the browser tests.
"""

import argparse
import functools
import http.server
import os
import re
import threading
from pathlib import Path

ROOT = Path(__file__).parent.parent
SAMPLE = "Hyperelastic block with a rigid plate"
SIZE = {"width": 1280, "height": 800}
PHONE = {"width": 390, "height": 844}
READY = "text=/FElupe [0-9.]+ ready/"
THEMES = ("dark", "light")


def shrink(path):
    """Reduce a PNG to 256 colors (if Pillow is installed): the UI has few."""
    try:
        from PIL import Image
    except ImportError:
        return
    with Image.open(path) as image:
        small = image.convert("RGB").quantize(colors=256, method=Image.FASTOCTREE)
    small.save(path, optimize=True)


def report(path):
    """Print the name (in the repository) and the size of a written picture."""
    name = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
    print(f"{name}: {path.stat().st_size // 1024} kB")


def prepare(context, theme):
    """The app of a browser context in a theme, without the tip about picking of the
    first visit."""
    context.add_init_script(
        "localStorage.setItem('felupe-studio.tip.pick', 'seen');"
        f"localStorage.setItem('felupe-studio.theme', '{theme}')"
    )


def capture(context, url, out, theme="dark"):
    """Open the app at ``url`` in a browser context and write the screenshots."""
    out.mkdir(parents=True, exist_ok=True)
    prepare(context, theme)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def shot(name):
        page.wait_for_timeout(800)
        path = out / f"{name}.png"
        page.screenshot(path=str(path))
        shrink(path)
        report(path)

    page.goto(url)
    page.wait_for_selector(READY, timeout=300_000)
    open_welcome(page)
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
        # by its title, which the description of another sample may name
        heading = page.get_by_role("heading", name=title, exact=True)
        card = page.get_by_role("dialog").locator("li").filter(has=heading)
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
    open_sample(
        "Hyperelastic spring with end stops (FElupe ex06)",
        "hyperelastic-spring.felupe.zip",
    )
    page.wait_for_selector("text=hyperelastic-spring.felupe.zip")
    solve(substep=5, quantity="strain_max")
    page.get_by_label("Curve", exact=True).set_checked(True)
    # the plates in the middle without labels
    set_pressed(page.get_by_role("button", name="Min/Max"), False)
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

    # v0.7: the mesh tools, the bushing of ex05 made with them: the revolved mesh of
    # the soft body with the meshes it is made of below it in the browser, then the
    # section in the xy-plane, construction meshes, with the form of the runouts
    open_sample("Bushing made with mesh tools", "bushing-tools.felupe.zip")
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.wait_for_selector("text=bushing-tools.felupe.zip")
    browser = page.get_by_role("navigation", name="Model browser")
    browser.get_by_text("soft_mesh", exact=True).click()
    page.wait_for_timeout(2000)  # the meshes of the tools are made in the worker
    page.mouse.move(500, 20)  # not over a row of the browser
    shot("mesh-tools")
    page.keyboard.press("Escape")
    for name in ["soft_mesh", "inner_sleeve", "outer_sleeve"]:
        browser.get_by_role("button", name=f"Hide {name}").click()
    for name in ["runouts", "inner_section", "outer_section"]:
        browser.get_by_role("button", name=f"Show {name}").click()
    browser.get_by_text("runouts", exact=True).click()
    page.keyboard.press("2")  # the xy-plane
    page.mouse.move(500, 20)
    shot("mesh-section")

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

    # v0.8: the Mullins effect, the bushing in filled rubber back at the start after
    # its first load cycle: the maximum strain energy density that the rubber keeps,
    # and the curve of the softer second loading (#346)
    open_sample("Bushing with the Mullins effect", "bushing-mullins.felupe.zip")
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.wait_for_selector("text=bushing-mullins.felupe.zip")
    solve(substep=14, quantity="mullins_energy")
    page.get_by_label("Curve", exact=True).set_checked(True)
    shot("mullins")

    # v0.9: the range of a contour from chosen sections (#377), the bushing with steel
    # sleeves, whose rubber is one color at the low end of a scale set by the steel
    # otherwise: the contour settings with the range of soft_body
    open_sample("Bushing with steel sleeves (FElupe ex05)", "bushing.felupe.zip")
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.wait_for_selector("text=bushing.felupe.zip")
    solve(quantity="stress_mises")
    page.get_by_label("Curve", exact=True).set_checked(False)
    page.get_by_label("Undeformed", exact=True).set_checked(False)
    # the extremes of the rubber, which match the scale
    set_pressed(page.get_by_role("button", name="Min/Max"), True)
    page.get_by_role("button", name="Contour settings").click()
    settings = page.get_by_role("dialog", name="Contour settings")
    settings.get_by_label("soft_body", exact=True).check()
    shot("range-of-sections")

    # the light theme for a report (#375): the same view on white
    page.keyboard.press("Escape")
    page.get_by_role("button", name="Theme", exact=True).click()
    page.get_by_role("menuitemradio", name=re.compile("^Light")).click()
    shot("light")

    # own colors of the sections (#376): the rubber in black, the steel in gray
    page.get_by_role("button", name="Model", exact=True).click()
    browser = page.get_by_role("navigation", name="Model browser")
    for name, color in [("soft_body", "#2b2d42"), ("sleeves", "#a3a8ad")]:
        browser.get_by_text(name, exact=True).click()
        page.get_by_role("textbox", name="Color", exact=True).fill(color)
        page.get_by_role("button", name="Apply", exact=True).click()
    page.keyboard.press("Escape")
    # the sleeves without the symbols of the boundary, the constraint and the points
    for name in ["fixed", "connect", "inner", "outer"]:
        browser.get_by_role("button", name=f"Hide {name}").click()
    page.get_by_label("Color by").select_option("section")
    page.mouse.move(500, 20)
    shot("section-colors")

    if errors:
        raise RuntimeError(f"Errors of the page: {errors}")


def set_pressed(button, pressed):
    """Press a toggle button of the toolbar, or release it."""
    if (button.get_attribute("aria-pressed") == "true") != pressed:
        button.click()


def open_welcome(page, title=SAMPLE):
    """Open a sample from the list of the welcome panel."""
    welcome = page.get_by_role("region", name="Welcome to FElupe Studio")
    sample = welcome.locator("li", has_text=title)
    sample.get_by_role("button", name="Open").click()


def capture_phone(context, url, out, theme="dark"):
    """The app on a phone in portrait (v0.9, #378): the model and the results with
    the curve below the view, side by side in one picture."""
    try:
        from PIL import Image
    except ImportError:
        print("phone.png: skipped, needs Pillow")
        return
    import io

    prepare(context, theme)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_selector(READY, timeout=300_000)
    open_welcome(page)
    page.get_by_text("0 issues", exact=True).wait_for()
    page.wait_for_timeout(800)
    shots = [page.screenshot()]

    # the results: the von Mises stress, and the curve turned on in More controls
    page.get_by_role("button", name="Solve").first.click()
    page.get_by_role("button", name="Show results").click(timeout=300_000)
    page.wait_for_timeout(1500)
    page.locator(".results-controls select").first.select_option("stress_mises")
    more = page.get_by_role("button", name="More controls")
    more.click()
    page.get_by_label("Curve", exact=True).check()
    more.click()
    # the view is smaller with the curve below it: Fit
    page.get_by_role("toolbar", name="View").get_by_role("button", name="Fit").click()
    page.wait_for_timeout(1500)
    shots.append(page.screenshot())
    if errors:
        raise RuntimeError(f"Errors of the page: {errors}")

    # side by side, with a transparent gap
    images = [Image.open(io.BytesIO(shot)).convert("RGBA") for shot in shots]
    width, height = images[0].size
    gap = width // 12
    picture = Image.new("RGBA", (2 * width + gap, height), (0, 0, 0, 0))
    for i, image in enumerate(images):
        picture.paste(image, (i * (width + gap), 0))
    path = out / "phone.png"
    picture.quantize(colors=256, method=Image.FASTOCTREE).save(path, optimize=True)
    report(path)


def capture_agent(browser, dist, out, port, theme="dark"):
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
        prepare(context, theme)
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
        report(path)
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
    parser.add_argument(
        "--theme", choices=THEMES, default="dark", help="the theme of the app (#375)"
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
            chrome = os.environ.get("CHROME")
            browser = playwright.chromium.launch(
                args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                **({"executable_path": chrome} if chrome else {}),
            )
            url = f"http://127.0.0.1:{args.port}/index.html"

            def context(**options):
                """A browser context of the app, with Pyodide from a folder."""
                new = browser.new_context(service_workers="block", **options)
                if args.pyodide:
                    route_pyodide(new, args.pyodide)
                return new

            capture(context(viewport=SIZE), url, args.out, args.theme)
            phone = context(
                viewport=PHONE, device_scale_factor=2, is_mobile=True, has_touch=True
            )
            capture_phone(phone, url, args.out, args.theme)
            capture_agent(browser, args.dist, args.out, args.port + 1, args.theme)
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
