"""Make the icons of a brand (ADR 0020) from its logo: ``icon-192.png`` and
``icon-512.png`` next to ``logo.svg``, for the manifest of the app.

The icon is the logo on the color of the bar of the app, with a margin. Run it from
the repository root, for the default brand or for a brand folder::

    pip install playwright
    playwright install chromium
    python app/scripts/make_icons.py [app/brand]

``CHROME`` sets the path of another Chrome or Chromium, like the e2e tests.
"""

import argparse
import base64
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

BAR = "#171a21"
"""The color of the bar of the app (``--color-bar`` of ``shell.css``)."""

SIZES = (192, 512)


def page(logo, size):
    """An HTML page of the icon: the logo on the bar color, 70 % of the icon."""
    inner = round(0.7 * size)
    return (
        f'<html><body style="margin:0;width:{size}px;height:{size}px;'
        f"background:{BAR};display:flex;align-items:center;"
        f'justify-content:center">'
        f'<img src="data:image/svg+xml;base64,{logo}" '
        f'width="{inner}" height="{inner}"></body></html>'
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    root = Path(__file__).parents[1]
    parser.add_argument("brand", nargs="?", default=root / "brand", type=Path)
    args = parser.parse_args(argv)
    logo = base64.b64encode((args.brand / "logo.svg").read_bytes()).decode()
    chrome = os.environ.get("CHROME")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            **({"executable_path": chrome} if chrome else {})
        )
        for size in SIZES:
            tab = browser.new_page(viewport={"width": size, "height": size})
            tab.set_content(page(logo, size))
            tab.wait_for_load_state("networkidle")
            tab.screenshot(path=args.brand / f"icon-{size}.png")
            tab.close()
        browser.close()
    for size in SIZES:
        print(args.brand / f"icon-{size}.png")


if __name__ == "__main__":
    main()
