"""Make the screenshots of the user guide and the README from the samples.

Build the app first (``cd app && npm run build``), then run from the repository
root::

    pip install playwright pillow
    playwright install chromium
    python docs/make_screenshots.py

The script serves ``app/dist``, opens the sample *Rubber block with a rigid plate*,
solves it with Python in the browser (the first start downloads Pyodide) and writes
small PNGs to ``docs/images``: the model, the results and a pressure on a face set.
"""

import argparse
import functools
import http.server
import re
import threading
from pathlib import Path

ROOT = Path(__file__).parent.parent
SAMPLE = "Rubber block with a rigid plate"
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
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size // 1024} kB")

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
    page.keyboard.press("1")  # the isometric view
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

    if errors:
        raise RuntimeError(f"Errors of the page: {errors}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dist", type=Path, default=ROOT / "app" / "dist")
    parser.add_argument("--out", type=Path, default=ROOT / "docs" / "images")
    parser.add_argument("--port", type=int, default=8765)
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
            capture(context, f"http://127.0.0.1:{args.port}/index.html", args.out)
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
