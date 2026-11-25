"""The app with the local Python runtime in a browser (#240, ADR 0014): a sample
opened from felupe-studio serve, solved with CPython, its results shown.

Needs Playwright with Chromium (``pip install playwright && playwright install
chromium``, or ``CHROME`` with the path of a Chrome) and the built app
(``npm run build`` in app/). Run with ``pytest -m e2e``.
"""

import base64
import json
import os
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

sync_api = pytest.importorskip("playwright.sync_api")
pytest.importorskip("uvicorn")

TOKEN = "e2e-token"


@pytest.fixture(scope="module")
def url(serve):
    return f"http://127.0.0.1:{serve(token=TOKEN)}/?token={TOKEN}"


def options(full=False):
    """The options of the launch of Chromium: WebGL of the viewer without a GPU, and
    ``CHROME`` as the path of a Chrome, if given. ``full`` takes the full Chromium of
    Playwright instead of its headless shell, e.g. for its site settings."""
    chrome = os.environ.get("CHROME")
    browser = {"executable_path": chrome} if chrome else {}
    if full and not chrome:
        browser = {"channel": "chromium"}
    return {
        "args": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        **browser,
    }


VIEWPORT = {"width": 1280, "height": 800}


def new_page(context):
    """A page of a context, without the tip of picking, which records its errors."""
    context.add_init_script("localStorage.setItem('felupe-studio.tip.pick', 'seen')")
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    return page


@pytest.fixture
def page(url):
    with sync_api.sync_playwright() as playwright:
        browser = playwright.chromium.launch(**options())
        yield new_page(browser.new_context(viewport=VIEWPORT))
        browser.close()


# The save dialog of the system (#400), replaced by one that records the written
# files. The real dialog of Chromium checks the options first: without a window, it
# cancels at once, and it throws a TypeError for options that it does not take.
# `window.chosen` is the name chosen in the dialog, `window.cancel` is its Cancel.
RECORD_SAVES = """(() => {
  if (!window.showSaveFilePicker) return;
  const real = window.showSaveFilePicker.bind(window);
  Object.assign(window, { picked: [], saved: [], cancel: false });
  window.showSaveFilePicker = async (options) => {
    await real(options).catch((error) => {
      if (error.name !== "AbortError") throw error;
    });
    window.picked.push(options);
    if (window.cancel)
      throw new DOMException("The user aborted a request.", "AbortError");
    const name = window.chosen ?? options.suggestedName;
    return {
      name,
      createWritable: async () => {
        const parts = [];
        return {
          write: async (data) => void parts.push(data),
          close: async () => {
            const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
            let text = "";
            for (const byte of bytes) text += String.fromCharCode(byte);
            window.saved.push({ name, data: btoa(text) });
          },
          abort: async () => {},
        };
      },
    };
  };
})()"""


def saved(page, action):
    """The name and the bytes of the file that `action` saves in the save dialog."""
    count = page.evaluate("window.saved.length")
    action()
    page.wait_for_function(f"window.saved.length > {count}")
    file = page.evaluate(f"window.saved[{count}]")
    return file["name"], base64.b64decode(file["data"])


def export(page, name):
    """Choose an item of the Export menu of the header."""
    page.get_by_role("button", name="Export", exact=True).click()
    page.get_by_role("menuitem", name=name).click()


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
    page.context.add_init_script(RECORD_SAVES)
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

    # the sleeves hidden (#396): the rubber alone, with its range, also in a picture
    def picture():
        _, data = saved(page, lambda: export(page, "Picture of the view"))
        assert data.startswith(b"\x89PNG")
        return base64.b64encode(data).decode()

    def others(mode):
        page.get_by_role("button", name="Contour settings").click()
        group = popover.get_by_role("group", name="Other sections")
        group.get_by_role("radio", name=mode).check()
        page.keyboard.press("Escape")

    with_sleeves = picture()
    others("Hidden")
    page.wait_for_function(
        "() => JSON.parse(localStorage.getItem('felupe-studio.contour')).others"
        " === 'hidden'"
    )
    assert note.inner_text() == "Range: soft_body"
    assert float(high.inner_text()) == rubber
    without = picture()
    assert page.evaluate(DIFFERENT, [with_sleeves, without]) > 1000
    # in one color: drawn again, without their contour
    others("One color")
    gray = picture()
    assert page.evaluate(DIFFERENT, [without, gray]) > 1000
    assert page.evaluate(DIFFERENT, [with_sleeves, gray]) > 1000
    assert page.errors == []


# the number of pixels that differ between two PNGs of the same size
DIFFERENT = """async ([a, b]) => {
    const pixels = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        [canvas.width, canvas.height] = [image.width, image.height];
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [p, q] = [await pixels(a), await pixels(b)];
    if (p.length !== q.length) return -1;
    let count = 0;
    for (let i = 0; i < p.length; i += 4)
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2])
            count += 1;
    return count;
}"""


def test_a_light_app_does_not_start_dark(url, page):
    """The theme of the stored choice before the first paint (#375): without the
    scripts of the app, the page is light already, and so is its theme color."""
    page.context.add_init_script("localStorage.setItem('felupe-studio.theme', 'light')")
    page.route(re.compile(r"/assets/.*\.js$"), lambda route: route.abort())
    page.goto(url)
    assert page.evaluate("document.documentElement.dataset.theme") == "light"
    background = page.evaluate(
        "getComputedStyle(document.documentElement).backgroundColor"
    )
    assert background == "rgb(238, 240, 244)"
    assert page.evaluate("document.getElementById('app').childElementCount") == 0
    theme_color = page.locator('meta[name="theme-color"]')
    assert theme_color.get_attribute("content") == "#e9ecf1"

    # the default stays dark
    page.context.add_init_script("localStorage.removeItem('felupe-studio.theme')")
    page.goto(url)
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    background = page.evaluate(
        "getComputedStyle(document.documentElement).backgroundColor"
    )
    assert background == "rgb(27, 31, 39)"
    assert theme_color.get_attribute("content") == "#171a21"


# the pixels of a PNG: its size, its corners and how many differ from the top left
PIXELS = """async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [image.width, image.height];
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data: rgba } = context.getImageData(0, 0, image.width, image.height);
    const at = (x, y) => {
        const i = 4 * (y * image.width + x);
        return [...rgba.slice(i, i + 3)];
    };
    const [w, h] = [image.width - 1, image.height - 1];
    let drawn = 0;
    for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i] !== rgba[0] || rgba[i + 1] !== rgba[1] || rgba[i + 2] !== rgba[2])
            drawn += 1;
    return { corners: [at(0, 0), at(w, 0), at(0, h), at(w, h)], drawn };
}"""


def test_a_light_picture_of_the_view(url, page):
    """The picture of the view in the light theme (#375): on the white background of
    the view, e.g. for a report; in the dark theme on its dark background."""
    page.context.add_init_script("localStorage.setItem('felupe-studio.theme', 'light')")
    page.context.add_init_script(RECORD_SAVES)
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    samples = page.get_by_role("dialog")
    title = page.get_by_role(
        "heading", name="Hyperelastic block with a rigid plate", exact=True
    )
    samples.locator("li").filter(has=title).get_by_role("button", name="Open").click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    def picture():
        _, data = saved(page, lambda: export(page, "Picture of the view"))
        assert data.startswith(b"\x89PNG")
        return page.evaluate(PIXELS, base64.b64encode(data).decode())

    light = picture()
    assert light["corners"] == [[255, 255, 255]] * 4
    assert light["drawn"] > 1000

    # the picture follows a new theme
    page.get_by_role("button", name="Theme").click()
    page.get_by_role("menuitemradio", name=re.compile("^Dark")).click()
    dark = picture()
    assert dark["corners"] == [[38, 43, 54]] * 4
    assert dark["drawn"] > 1000
    assert page.errors == []


# the rows of the app and the viewport in the window, and whether the page scrolls
def open_block(page):
    """Open the sample *Hyperelastic block with a rigid plate*, ready to solve."""
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    title = page.get_by_role(
        "heading", name="Hyperelastic block with a rigid plate", exact=True
    )
    page.get_by_role("dialog").locator("li").filter(has=title).get_by_role(
        "button", name="Open"
    ).click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    # the shortcuts work once the dialog of the samples has closed
    page.wait_for_function("!document.querySelector('[role=dialog][aria-modal=true]')")


def test_saving_with_the_save_dialog(url, page):
    """Save and export with the save dialog of the system (#400): the first save
    asks, the next one writes into the chosen file without asking, an export asks in
    the folder of the exports, and Cancel saves nothing. The real dialog of Chromium
    checks the options of each."""
    page.context.add_init_script(RECORD_SAVES)
    page.goto(url)
    open_block(page)
    header = page.get_by_role("banner")

    # the first save asks; the name chosen there is the name of the project
    page.evaluate("window.chosen = 'block.felupe.zip'")
    name, data = saved(page, lambda: page.keyboard.press("Control+s"))
    assert name == "block.felupe.zip"
    assert data.startswith(b"PK")
    assert page.evaluate("window.picked") == [
        {
            "suggestedName": "glued-plate.felupe.zip",
            "id": "felupe-studio-projects",
            "types": [
                {
                    "description": "Project archive",
                    "accept": {"application/zip": [".felupe.zip"]},
                }
            ],
        }
    ]
    assert "block.felupe.zip" in header.inner_text()

    # the next save writes into the same file without asking
    page.evaluate("window.chosen = undefined")
    save = header.get_by_role("button", name="Save project")
    name, data = saved(page, save.click)
    assert name == "block.felupe.zip"
    assert data.startswith(b"PK")
    assert page.evaluate("window.picked.length") == 1

    # an export asks, in the folder of the exports; then the script is made
    name, data = saved(page, lambda: export(page, "Python script"))
    assert name == "block.py"
    assert b"import felupe" in data
    assert page.evaluate("window.picked[1]") == {
        "suggestedName": "block.py",
        "id": "felupe-studio-exports",
        "types": [
            {"description": "Python script", "accept": {"text/x-python": [".py"]}}
        ],
    }

    # Cancel saves nothing and shows no error
    page.evaluate("window.cancel = true")
    export(page, "Picture of the view")
    page.wait_for_function("window.picked.length === 3")
    page.wait_for_timeout(500)
    # the two saves and the script
    assert page.evaluate("window.saved.length") == 3
    assert page.get_by_role("alert").count() == 0
    assert page.errors == []


def test_downloads_without_the_save_dialog(url, page):
    """A browser without the save dialog (Firefox, Safari) downloads the files as
    before (#400)."""
    page.context.add_init_script("delete window.showSaveFilePicker")
    page.goto(url)
    assert page.evaluate("typeof window.showSaveFilePicker") == "undefined"
    open_block(page)
    with page.expect_download() as download:
        page.keyboard.press("Control+s")
    assert download.value.suggested_filename == "glued-plate.felupe.zip"
    assert Path(download.value.path()).read_bytes().startswith(b"PK")
    with page.expect_download() as download:
        export(page, "Python script")
    assert download.value.suggested_filename == "glued-plate.py"
    assert page.errors == []


def test_downloads_where_the_browser_refuses_the_save_dialog(url, tmp_path):
    """Chromium with the site setting *File editing* blocked, like a policy does,
    refuses the save dialog with a NotAllowedError (#439): the files are downloaded,
    after a note once, and the next ones without trying the dialog."""
    profile = tmp_path / "profile"
    (profile / "Default").mkdir(parents=True)
    settings = {"default_content_setting_values": {"file_system_write_guard": 2}}
    (profile / "Default" / "Preferences").write_text(json.dumps({"profile": settings}))
    with sync_api.sync_playwright() as playwright:
        # the headless shell of Playwright has no site settings: it cancels the
        # dialog instead of refusing it
        context = playwright.chromium.launch_persistent_context(
            str(profile), viewport=VIEWPORT, accept_downloads=True, **options(full=True)
        )
        page = new_page(context)
        # the dialog of the browser, which records its calls
        context.add_init_script(
            """(() => {
              const real = window.showSaveFilePicker.bind(window);
              window.picked = 0;
              window.showSaveFilePicker = (options) => (window.picked++, real(options));
            })()"""
        )
        page.goto(url)
        open_block(page)
        with page.expect_download() as download:
            page.keyboard.press("Control+s")
        assert download.value.suggested_filename == "glued-plate.felupe.zip"
        assert Path(download.value.path()).read_bytes().startswith(b"PK")
        note = page.get_by_role("status", name="Note")
        assert "so they are downloaded" in note.inner_text()
        assert "site setting File editing" in note.inner_text()
        assert page.get_by_role("alert").count() == 0
        # the next save and an export download without the dialog
        note.get_by_role("button", name="Dismiss").click()
        with page.expect_download() as download:
            page.keyboard.press("Control+s")
        assert download.value.suggested_filename == "glued-plate.felupe.zip"
        with page.expect_download() as download:
            export(page, "Python script")
        assert download.value.suggested_filename == "glued-plate.py"
        assert page.evaluate("window.picked") == 1
        assert page.get_by_role("status", name="Note").count() == 0
        assert page.errors == []
        context.close()


LAYOUT = """() => {
    const box = (selector) => {
        const element = [...document.querySelectorAll(selector)].find(
            (e) => !e.hidden,
        );
        const { top, bottom } = element.getBoundingClientRect();
        return { top, bottom };
    };
    const page = document.scrollingElement;
    return {
        width: innerWidth,
        height: innerHeight,
        scrolls: page.scrollWidth > innerWidth || page.scrollHeight > innerHeight,
        compact: document.querySelector(".shell").classList.contains("compact"),
        viewport: box(".viewport"),
        footer: box(".footer"),
    };
}"""


def test_the_menus_of_the_header_stay_in_the_window(url, page):
    """Every menu of the header is inside the window with a margin of 8 px, also the
    theme menu on a phone in portrait (#402); on a desktop, a menu opens at its
    button as before."""
    page.goto(url)
    page.get_by_role("button", name="Theme", exact=True).wait_for()

    def opened(name):
        button = page.get_by_role("button", name=name, exact=True)
        button.click()
        menu = page.get_by_role("menu", name=name, exact=True)
        menu.wait_for()
        return button.bounding_box(), menu

    for width, height in [(390, 844), (360, 740), (844, 390)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(300)
        for name in ["File", "Help", "Theme"]:
            _, menu = opened(name)
            # every item too, i.e. its label and its hint are not cut off
            for box in [menu.bounding_box()] + [
                item.bounding_box()
                for item in menu.get_by_role("menuitem").all()
                + menu.get_by_role("menuitemradio").all()
            ]:
                assert box["x"] >= 8 - 0.5, (width, name, box)
                assert box["x"] + box["width"] <= width - 8 + 0.5, (width, name, box)
            page.keyboard.press("Escape")
            menu.wait_for(state="detached")

    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(300)
    for name, end in [("File", False), ("Help", False), ("Theme", True)]:
        button, menu = opened(name)
        box = menu.bounding_box()
        if end:
            assert abs(box["x"] + box["width"] - button["x"] - button["width"]) < 1
        else:
            assert abs(box["x"] - button["x"]) < 1
        page.keyboard.press("Escape")
        menu.wait_for(state="detached")
    # an Esc right after the click closes the menu: its focus and its keys are there
    # before it is painted
    for name in ["File", "Help", "Theme"]:
        page.get_by_role("button", name=name, exact=True).click()
        page.keyboard.press("Escape")
        page.get_by_role("menu", name=name, exact=True).wait_for(state="detached")


def test_the_compact_layout_of_a_phone(url, page):
    """The compact layout of phones and short windows (#378): the page does not
    scroll, the footer is below the viewport, which has at least 70 % of the height
    in portrait, and every control is in the window."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    title = page.get_by_role(
        "heading", name="Hyperelastic block with a rigid plate", exact=True
    )
    page.get_by_role("dialog").locator("li").filter(has=title).get_by_role(
        "button", name="Open"
    ).click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    # the desktop keeps its layout
    assert not page.evaluate(LAYOUT)["compact"]
    assert page.get_by_role("button", name="Undo").is_visible()
    assert page.get_by_role("combobox", name="Command").is_visible()

    def inside(name, width, height, role="button"):
        box = page.get_by_role(role, name=name, exact=True).bounding_box()
        assert box, name
        assert box["x"] >= 0 and box["x"] + box["width"] <= width, name
        assert box["y"] >= 0 and box["y"] + box["height"] <= height, name

    tabs = ["Mesh", "Materials", "Sections", "Loads & BCs", "Steps & Job", "Script"]
    for width, height, compact in [
        (390, 844, True),
        (844, 390, True),
        (768, 1024, False),
    ]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(300)
        layout = page.evaluate(LAYOUT)
        assert layout["compact"] == compact, (width, height)
        assert not layout["scrolls"], (width, height)
        assert layout["footer"]["bottom"] <= height
        assert layout["viewport"]["bottom"] <= layout["footer"]["top"]
        share = (layout["viewport"]["bottom"] - layout["viewport"]["top"]) / height
        if height > width:
            assert share >= 0.7, (width, height, share)
        for name in ["Solve", "File", "Help", "Theme", "Model", "Results"]:
            inside(name, width, height)
        # every tab, in a row that scrolls; a compact one opens its commands
        for name in tabs:
            tab = page.get_by_role("tab", name=name, exact=True)
            tab.click()
            assert tab.get_attribute("aria-selected") == "true"
            inside(name, width, height, role="tab")
        page.get_by_role("tab", name="Mesh", exact=True).click()
        if compact:
            panel = page.locator("#ribbon-panel")
            assert panel.is_visible()
            assert not page.evaluate(LAYOUT)["scrolls"]
            panel.get_by_role("button", name="Point set").click()
            page.get_by_role("dialog").get_by_role("button", name="Cancel").click()
            assert not panel.is_visible()
            # the command line behind its button
            command = page.get_by_role("combobox", name="Command")
            assert not command.is_visible()
            page.get_by_role("button", name="Command line").click()
            assert command.is_visible()
            assert page.evaluate("document.activeElement.id") == "command"
            assert not page.evaluate(LAYOUT)["scrolls"]
            page.get_by_role("button", name="Command line").click()

    # the results: the contour and the substep in one row, the other controls behind
    # a button, the toolbar of the view in one row, the curve below or beside the view
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Solve").click()
    page.get_by_role("button", name="Show results").click(timeout=120_000)
    page.get_by_role("toolbar", name="View").wait_for(timeout=60_000)
    for width, height, compact in [
        (390, 844, True),
        (844, 390, True),
        (768, 1024, False),
    ]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(300)
        layout = page.evaluate(LAYOUT)
        assert not layout["scrolls"], (width, height)
        assert layout["viewport"]["bottom"] <= layout["footer"]["top"]
        share = (layout["viewport"]["bottom"] - layout["viewport"]["top"]) / height
        if height > width:
            assert share >= 0.7, (width, height, share)
        for name in ["Model", "Results", "Play", "Contour settings"]:
            inside(name, width, height)
        inside("Contour", width, height, role="combobox")
        inside("Substep 9 of 9", width, height, role="slider")
        if not compact:
            continue
        toolbar = page.get_by_role("toolbar", name="View")
        assert toolbar.bounding_box()["height"] < 50, (width, height)
        toolbar.get_by_role("button", name="Points").scroll_into_view_if_needed()
        inside("Points", width, height)
        more = page.get_by_role("button", name="More controls")
        more.click()
        for name in ["Scale", "Undeformed", "Curve", "Live results"]:
            box = page.get_by_label(name, exact=True).bounding_box()
            assert box and box["x"] + box["width"] <= width, name
            assert box["y"] + box["height"] <= height, name
        assert not page.evaluate(LAYOUT)["scrolls"]
        # the curve is off on a phone; it takes a part of the view, not covers it
        curve = page.get_by_label("Curve", exact=True)
        assert not curve.is_checked()
        curve.check()
        more.click()
        card = page.get_by_role("region", name="Force-displacement curve")
        sheet, viewer = page.evaluate(
            """() => [".overlay-side", 'main[aria-label="Results"] .viewer'].map(
                (s) => document.querySelector(s).getBoundingClientRect().toJSON())"""
        )
        if height > width:
            assert viewer["bottom"] <= sheet["top"] + 1
        else:
            assert viewer["right"] <= sheet["left"] + 1
        assert card.bounding_box()["x"] + card.bounding_box()["width"] <= width
        assert not page.evaluate(LAYOUT)["scrolls"]
        card.get_by_role("button", name="Close the curve").click()
    assert page.errors == []


def test_a_stacked_profile_revolved_and_solved(url, page):
    """A profile of three rectangles stacked into one mesh with the ribbon, revolved
    and solved (#394): the next operation takes the stacked mesh, not all meshes."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    def command(text, done):
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(done).first.wait_for(timeout=60_000)

    for name, x in [("left", 0), ("middle", 1), ("right", 2)]:
        parameters = f'{{"a": [{x}, 1], "b": [{x + 1}, 2], "n": [3, 3]}}'
        command(
            f'mesh.generate {{"name": "{name}", "tool": "Rectangle", '
            f'"parameters": {parameters}}}',
            f"Created {name}.",
        )

    def operation(tool, name):
        page.get_by_role("button", name="Operations").click()
        page.get_by_role("menuitem", name=tool, exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Name", exact=True).fill(name)
        return dialog

    # the meshes that no other tool takes, each a checkbox
    dialog = operation("Stack", "profile")
    for name in ["left", "middle", "right"]:
        assert dialog.get_by_role("checkbox", name=name, exact=True).is_checked()
    # two or more
    for name in ["middle", "right"]:
        dialog.get_by_role("checkbox", name=name, exact=True).uncheck()
    dialog.get_by_text("Select at least two.").wait_for()
    for name in ["middle", "right"]:
        dialog.get_by_role("checkbox", name=name, exact=True).check()
    dialog.get_by_role("button", name="Create").click()
    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("stack left, middle, right · construction").wait_for()

    dialog = operation("Revolve", "body")
    assert dialog.locator("select[id$='-inputs']").input_value() == "profile"
    dialog.get_by_label("n", exact=True).fill("5")
    dialog.get_by_label("φ [°]").fill("90")
    dialog.get_by_role("button", name="Create").click()
    tree.get_by_text("revolve profile · n = 5").wait_for()
    for text in [
        'cellset.from_file {"name": "cells", "mesh": "body"}',
        'material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}',
        'section.add {"name": "solid", "cellset": "cells", "material": "rubber", '
        '"formulation": "u-p-J", "bulk": 5000}',
        'pointset.add {"name": "start", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "end", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "start", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "pull", "pointset": "end", "constrained": ["x"]}',
        'step.add {"name": "tension", "ramp": {"num": 3, '
        '"items": [{"target": "pull", "end": 0.3}]}}',
        'job.add {"name": "job", "steps": ["tension"], "curve": "pull"}',
    ]:
        name = text.split('"name": "')[1].split('"')[0]
        command(text, f"Created {name}.")
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    assert "4 substeps" in summary and "Last substep: ux = 0.3" in summary
    results.click()
    page.wait_for_selector("text=/Displacement magnitude/", timeout=60_000)
    assert page.errors == []


def test_an_imported_half_mirrored_stacked_and_solved(url, page):
    """The half of a bar of a file, mirrored and stacked into the whole with the
    ribbon, and solved (#438): the mesh tools take a mesh of a file like a mesh made
    by them, shown below the mesh that uses it."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    def command(text, done):
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(done).first.wait_for(timeout=60_000)

    command('mesh.import {"name": "half", "file": "half.vtu"}', "Created half.")
    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("half", exact=True).click()
    half = Path(__file__).parents[1] / "golden" / "bar_mirrored_half" / "half.vtu"
    page.get_by_test_id("mesh-file").set_input_files(str(half))
    page.get_by_text("hexahedron", exact=False).first.wait_for(timeout=60_000)

    def operation(tool, name):
        page.get_by_role("button", name="Operations").click()
        page.get_by_role("menuitem", name=tool, exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Name", exact=True).fill(name)
        return dialog

    # the imported mesh is the input of the mirror
    dialog = operation("Mirror", "other")
    assert dialog.locator("select[id$='-inputs']").input_value() == "half"
    dialog.get_by_label("value", exact=True).fill("1.5")
    dialog.get_by_role("button", name="Create").click()
    tree.get_by_text("mirror half").wait_for()
    dialog = operation("Stack", "bar")
    dialog.get_by_role("checkbox", name="half", exact=True).check()
    assert dialog.get_by_role("checkbox", name="other", exact=True).is_checked()
    dialog.get_by_role("button", name="Create").click()
    tree.get_by_text("stack half, other").wait_for()
    for text in [
        'cellset.from_file {"name": "cells", "mesh": "bar"}',
        'material.add {"name": "rubber", "model": "NeoHookeCompressible", '
        '"parameters": {"mu": 1, "lmbda": 2}}',
        'section.add {"name": "body", "cellset": "cells", "material": "rubber", '
        '"formulation": "u"}',
        'pointset.add {"name": "left", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "right", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "left", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "move", "pointset": "right", "constrained": ["x"]}',
        'step.add {"name": "step_1", "ramp": {"num": 5, '
        '"items": [{"target": "move", "end": 0.5}]}}',
        'job.add {"name": "job_1", "steps": ["step_1"], "curve": "move"}',
    ]:
        name = text.split('"name": "')[1].split('"')[0]
        command(text, f"Created {name}.")
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    # the force of the bar of the golden cases, made of one piece
    assert "6 substeps" in summary
    assert "Last substep: ux = 0.5, Fx = 0.4005" in summary
    assert page.errors == []


def test_the_cell_sets_of_a_half_moved_to_the_whole_and_solved(url, page):
    """The half of a bar of two materials of a file with a cell tag, imported with a
    cell set per tag value, mirrored and stacked into the whole, which keeps the tag
    (#438): the cell sets move to the whole in their properties."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    page.get_by_role("tabpanel").get_by_role("button", name="Import mesh").click()
    dialog = page.get_by_role("dialog")
    golden = Path(__file__).parents[1] / "golden"
    half = golden / "bar_two_materials_mirrored" / "half.vtu"
    dialog.get_by_test_id("file-picker").set_input_files(str(half))
    dialog.get_by_text("material = 2, 48 cells").wait_for(timeout=60_000)
    dialog.get_by_role("button", name="Import", exact=True).click()
    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("half.vtu · tag material").wait_for()

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    command(
        'mesh.generate {"name": "other", "tool": "mirror", "inputs": ["half"], '
        '"parameters": {"axis": "y", "value": 0.5}}'
    )
    command(
        'mesh.generate {"name": "bar", "tool": "stack", "inputs": ["half", "other"], '
        '"parameters": {"decimals": 10}}'
    )
    tree.get_by_text("stack half, other · tag material").wait_for()
    properties = page.get_by_role("region", name="Properties")
    for name in ["material_1", "material_2"]:
        tree.get_by_text(name, exact=True).click()
        properties.locator("select[id$='-mesh']").select_option("bar")
        properties.get_by_role("button", name="Apply").click()
        properties.locator("select[id$='-mesh']").filter(has_text="bar").wait_for()
    for text in [
        'material.add {"name": "steel_like", "model": "LinearElasticLargeStrain", '
        '"parameters": {"E": 10, "nu": 0.3}}',
        'material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}',
        'section.add {"name": "hard_body", "cellset": "material_1", '
        '"material": "steel_like", "formulation": "u"}',
        'section.add {"name": "soft_body", "cellset": "material_2", '
        '"material": "rubber", "formulation": "u-p-J", "bulk": 5000}',
        'pointset.add {"name": "left", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "right", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "left", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "move", "pointset": "right", "constrained": ["x"]}',
        'step.add {"name": "step_1", "ramp": {"num": 5, '
        '"items": [{"target": "move", "end": 0.5}]}}',
        'job.add {"name": "job_1", "steps": ["step_1"], "curve": "move"}',
    ]:
        command(text)
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    # the force of the bar of two materials of the golden cases, of one file
    assert "6 substeps" in summary
    assert "Last substep: ux = 0.5, Fx = 0.6632" in summary, summary
    assert page.errors == []


def test_a_profile_of_a_file_revolved_and_solved(url, page):
    """A profile of quads with z = 0 imported into a 3D model as a construction mesh
    with the import dialog, revolved with the ribbon and solved (#438)."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    page.get_by_role("tabpanel").get_by_role("button", name="Import mesh").click()
    dialog = page.get_by_role("dialog")
    golden = Path(__file__).parents[1] / "golden"
    profile = golden / "tube_revolved_profile" / "profile.vtu"
    dialog.get_by_test_id("file-picker").set_input_files(str(profile))
    construction = dialog.get_by_label("Construction mesh", exact=False)
    construction.wait_for(timeout=60_000)
    assert construction.is_checked()
    dialog.get_by_text("quad, 12 cells, construction").wait_for()
    dialog.get_by_role("button", name="Import", exact=True).click()
    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("profile.vtu · construction").wait_for()

    page.get_by_role("button", name="Operations").click()
    page.get_by_role("menuitem", name="Revolve", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("Name", exact=True).fill("body")
    assert dialog.locator("select[id$='-inputs']").input_value() == "profile"
    dialog.get_by_label("n", exact=True).fill("5")
    dialog.get_by_label("φ [°]").fill("90")
    dialog.get_by_role("button", name="Create").click()
    tree.get_by_text("revolve profile · n = 5").wait_for()

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    for text in [
        'cellset.from_file {"name": "cells", "mesh": "body"}',
        'material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}',
        'section.add {"name": "solid", "cellset": "cells", "material": "rubber", '
        '"formulation": "u-p-J", "bulk": 5000}',
        'pointset.add {"name": "start", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "end", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "start", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "pull", "pointset": "end", "constrained": ["x"]}',
        'step.add {"name": "tension", "ramp": {"num": 3, '
        '"items": [{"target": "pull", "end": 0.3}]}}',
        'job.add {"name": "job", "steps": ["tension"], "curve": "pull"}',
    ]:
        command(text)
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    assert "4 substeps" in summary and "Last substep: ux = 0.3" in summary
    assert page.errors == []


def test_a_step_that_releases_a_boundary_solved(url, page):
    """A step without a boundary, made with its form, and solved (#393): the
    viewport fades the boundary with the step selected, the free end springs back,
    and the curve of the boundary gets a note."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    for text in [
        'mesh.generate {"name": "bar", "tool": "Cube", '
        '"parameters": {"a": [0, 0, 0], "b": [3, 1, 1], "n": [4, 2, 2]}}',
        'cellset.from_file {"name": "cells", "mesh": "bar"}',
        'material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}',
        'section.add {"name": "solid", "cellset": "cells", "material": "rubber", '
        '"formulation": "u-p-J", "bulk": 5000}',
        'pointset.add {"name": "start", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "end", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "start", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "pull", "pointset": "end", "constrained": ["x"]}',
        'step.add {"name": "tension", "ramp": {"num": 3, '
        '"items": [{"target": "pull", "end": 0.3}]}}',
    ]:
        command(text)

    # the boundaries of the step: all by default, here only fixed
    page.get_by_role("tab", name="Steps & Job", exact=True).click()
    page.locator("#ribbon-panel").get_by_role("button", name="Step", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("Name", exact=True).fill("release")
    boundaries = dialog.get_by_role("group", name="Boundaries")
    boundaries.get_by_text("all (default)").wait_for()
    switched_on = dialog.get_by_label("Switched on")
    assert switched_on.locator("option").all_inner_texts() == [
        "At the start of the step (default)",
        "At the start of the job",
    ]
    boundaries.get_by_role("checkbox", name="fixed", exact=True).check()
    assert not boundaries.get_by_role("checkbox", name="pull").is_checked()
    dialog.get_by_role("button", name="Create").click()
    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("no ramp · off: pull").wait_for()
    # selected, the viewport fades what is off in the step
    tree.get_by_text("release", exact=True).click()
    page.get_by_role("main", name="Viewport").get_by_text(
        "Off in release (faded): pull", exact=True
    ).wait_for()

    command('job.add {"name": "job", "steps": ["tension", "release"], "curve": "pull"}')
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    # the note of the curve, in the properties of the job
    page.get_by_text(
        "job 'job' records the curve of 'pull', which is off in step 'release': "
        "its force is zero there."
    ).wait_for()

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    # the free end springs back: no displacement and no force
    assert "5 substeps" in summary
    last = summary.split("Last substep: ")[1]
    ux, fx = (float(part.split(" = ")[1]) for part in last.split(", "))
    assert abs(ux) < 1e-8 and abs(fx) < 1e-8
    results.click()
    page.wait_for_selector("text=/Displacement magnitude/", timeout=60_000)
    assert page.errors == []


def test_a_section_switched_to_the_three_field_variation_solved(url, page):
    """A section of a material with its bulk modulus switched from the displacement
    formulation to the three-field variation in its properties, and solved (#420):
    the form shows when to use it and no bulk modulus of the section, and the script
    has fem.ThreeFieldVariation."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    for text in [
        'mesh.generate {"name": "bar", "tool": "Cube", '
        '"parameters": {"a": [0, 0, 0], "b": [3, 1, 1], "n": [4, 2, 2]}}',
        'cellset.from_file {"name": "cells", "mesh": "bar"}',
        'material.add {"name": "rubber", "model": "NeoHooke", '
        '"parameters": {"mu": 1, "bulk": 5000}}',
        'section.add {"name": "solid", "cellset": "cells", "material": "rubber", '
        '"formulation": "u"}',
        'pointset.add {"name": "start", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "end", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "start", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "pull", "pointset": "end", "constrained": ["x"]}',
        'step.add {"name": "tension", "ramp": {"num": 3, '
        '"items": [{"target": "pull", "end": 0.3}]}}',
        'job.add {"name": "job", "steps": ["tension"], "curve": "pull"}',
    ]:
        command(text)

    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("solid", exact=True).click()
    properties = page.get_by_role("region", name="Properties")
    properties.get_by_label("Formulation").select_option(label="Three-field variation")
    properties.get_by_text(
        "Any material with a volumetric part, also compressible or strain-based; "
        "the slowest"
    ).wait_for()
    assert properties.get_by_label("Bulk modulus").count() == 0
    properties.get_by_role("button", name="Apply").click()
    tree.get_by_text("rubber · u-p-J-three-field").wait_for()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("tab", name="Script", exact=True).click()
    page.get_by_text(
        "solid_solid = fem.SolidBody(fem.ThreeFieldVariation(rubber), field_solid)"
    ).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    assert "4 substeps" in summary and "Last substep: ux = 0.3" in summary
    results.click()
    page.wait_for_selector("text=/Displacement magnitude/", timeout=60_000)
    assert page.errors == []


def test_a_cut_of_the_model(url, page):
    """A cut of the view in the Model workspace (#395): the meshes are cut by the
    local Python, and without the cut the view is the same as before."""
    page.context.add_init_script(RECORD_SAVES)
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    title = page.get_by_role(
        "heading", name="Bushing with steel sleeves (FElupe ex05)", exact=True
    )
    page.get_by_role("dialog").locator("li").filter(has=title).get_by_role(
        "button", name="Open"
    ).click()
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    # the meshes of the script are drawn
    cut = page.get_by_role("combobox", name="Cut")
    cut.wait_for(timeout=60_000)
    page.locator(".viewport-status").wait_for(state="detached", timeout=60_000)

    def picture():
        _, data = saved(page, lambda: export(page, "Picture of the view"))
        return base64.b64encode(data).decode()

    def changed(before):
        # the cut arrives from Python after the request
        for _ in range(50):
            after = picture()
            if page.evaluate(DIFFERENT, [before, after]) > 1000:
                return after
            page.wait_for_timeout(100)
        raise AssertionError("The view did not change.")

    whole = picture()
    assert cut.locator("option").all_inner_texts() == [
        "No cut",
        "Cut x",
        "Cut y",
        "Cut z",
    ]
    # by x at the middle of the bushing, through its rubber and its sleeves
    cut.select_option("x")
    field = page.get_by_role("spinbutton", name="Coordinate of the cut, x")
    assert field.input_value() == "0"
    half = changed(whole)
    page.get_by_role("button", name="Hide x >").click()
    page.get_by_role("button", name="Hide x <").wait_for()
    changed(half)
    # without the cut, the view of the whole model again
    cut.select_option("")
    assert page.evaluate(DIFFERENT, [whole, picture()]) == 0
    assert page.errors == []


def test_a_cut_of_the_results(url, page):
    """A cut of the view in the Results workspace (#395): the bushing with steel
    sleeves cut at z = 0 through its axis, the von Mises stress inside its rubber,
    the cut face moving with the material from substep to substep."""
    page.context.add_init_script(RECORD_SAVES)
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="Samples…").click()
    title = page.get_by_role(
        "heading", name="Bushing with steel sleeves (FElupe ex05)", exact=True
    )
    page.get_by_role("dialog").locator("li").filter(has=title).get_by_role(
        "button", name="Open"
    ).click()
    page.get_by_role("dialog", name=re.compile("^Parameters")).get_by_role(
        "button", name="Open", exact=True
    ).click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    # the cut of the Model workspace, by z at the middle: through the axis x
    page.get_by_role("combobox", name="Cut").select_option("z")
    assert (
        page.get_by_role("spinbutton", name="Coordinate of the cut, z").input_value()
        == "0"
    )

    page.get_by_role("button", name="Solve").click()
    shown = page.get_by_role("button", name="Show results")
    shown.wait_for(timeout=120_000)
    shown.click()
    page.locator(".results-controls select").filter(
        has=page.locator("option[value=stress_mises]")
    ).select_option("stress_mises")
    page.locator(".app-scalar-bar .fv-bar-title", has_text="Von Mises").wait_for(
        timeout=60_000
    )
    view = page.get_by_role("main", name="Results")
    # the same cut in the results, a setting of the view
    cut = view.get_by_role("combobox", name="Cut")
    assert cut.input_value() == "z"
    page.get_by_label("Curve", exact=True).set_checked(False)
    page.get_by_label("Undeformed", exact=True).set_checked(False)
    # onto the cut face: the xy-plane, seen from the hidden half
    view.get_by_role("button", name="View onto the xy-plane").click()
    page.locator(".viewport-status").wait_for(state="detached", timeout=60_000)

    def picture():
        _, data = saved(page, lambda: export(page, "Picture of the view"))
        assert data.startswith(b"\x89PNG")
        return base64.b64encode(data).decode()

    def values():
        # the values under the pointer along a line down the middle of the view,
        # across the sleeves and the rubber between them
        box = view.locator("canvas.fv-gl").first.bounding_box()
        tip = page.locator(".probe-tooltip")
        found = {}
        for i in range(2, 19):
            y = box["y"] + box["height"] * i / 20
            page.mouse.move(box["x"] + box["width"] * 0.5, y)
            page.wait_for_timeout(100)
            # the values of the cells, not the control point at the axis
            lines = tip.inner_text().splitlines() if tip.count() else []
            if len(lines) == 2 and lines[1].startswith("Cell "):
                found[i] = tuple(lines)
        page.mouse.move(box["x"] + 5, box["y"] + box["height"] - 5)
        return found

    last = picture()
    inside = values()
    # the rubber and the steel of the cut face, with their stresses
    assert any(w.endswith("of soft_body") for _, w in inside.values()), inside
    assert any(w.endswith("of sleeves") for _, w in inside.values()), inside
    assert all(v.startswith("Von Mises") for v, _ in inside.values())

    # an earlier substep: the cut face moved with the material
    substep = page.get_by_role("slider", name=re.compile("^Substep"))
    substep.fill("3")
    page.get_by_text("Substep 3 of 7").wait_for()
    page.locator(".viewport-status").wait_for(state="detached", timeout=60_000)
    earlier = picture()
    assert page.evaluate(DIFFERENT, [last, earlier]) > 1000
    assert values() != inside

    # without the cut: the whole bushing; with it again, the same picture as before
    cut.select_option("")
    page.locator(".viewport-status").wait_for(state="detached", timeout=60_000)
    assert page.evaluate(DIFFERENT, [earlier, picture()]) > 1000
    cut.select_option("z")
    page.locator(".viewport-status").wait_for(state="detached", timeout=60_000)
    assert page.evaluate(DIFFERENT, [earlier, picture()]) == 0
    assert page.errors == []


def test_the_results_of_a_file_without_their_model(url, page):
    """The results of a job exported as XDMF and imported again (#414) in a new
    project: the plate with a hole in plane strain, with the units and the section
    of the file."""
    page.context.add_init_script(RECORD_SAVES)
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    card = page.locator(".sample-card").filter(has_text="Plate with a hole in plane")
    card.get_by_role("button", name="Open").click()
    page.get_by_role("dialog").get_by_role("button", name="Open", exact=True).click()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)
    page.get_by_role("button", name="Solve").click()
    page.get_by_role("button", name="Show results").wait_for(timeout=120_000)
    name, data = saved(page, lambda: export(page, re.compile("Results of the job")))
    assert name.endswith("-job.xdmf") and b'Name="felupe-studio"' in data

    # a new project without a model, its results imported from the file
    page.get_by_role("button", name="File", exact=True).click()
    page.get_by_role("menuitem", name="New project").click()
    page.locator(".welcome").wait_for(timeout=60_000)
    page.get_by_role("button", name="Results", exact=True).click()
    page.get_by_test_id("import-results").set_input_files(
        files=[{"name": name, "mimeType": "application/xml", "buffer": data}]
    )
    page.get_by_text(f"Results of {name}").wait_for(timeout=60_000)
    page.get_by_text("Substep 9 of 9").wait_for()
    controls = page.locator(".results-controls")
    # a 2D model: no displacement in z
    assert controls.locator("option[value=displacement_z]").count() == 0
    controls.locator("select").filter(
        has=page.locator("option[value=stress_mises]")
    ).select_option("stress_mises")
    # the units of the file
    page.locator(".app-scalar-bar .fv-bar-title", has_text="[MPa]").wait_for(
        timeout=60_000
    )
    page.locator(".viewport-status").wait_for(state="detached", timeout=60_000)

    # the values of the cells of the section of the file under the pointer
    view = page.get_by_role("main", name="Results")
    box = view.locator("canvas.fv-gl").first.bounding_box()
    tip = page.locator(".probe-tooltip")
    found = []
    for i in range(2, 19):
        page.mouse.move(box["x"] + box["width"] * i / 20, box["y"] + box["height"] / 2)
        page.wait_for_timeout(100)
        found += tip.inner_text().splitlines() if tip.count() else []
    assert any(line.endswith("of plate") for line in found), found
    assert page.errors == []


def test_a_cartesian_constraint_ramped_and_recorded(url, page):
    """A Cartesian constraint (#421) at the end of a bar, ramped along its first
    direction and recorded by the job: the ribbon has its button, the browser and the
    script show it, and the job panel shows the displacement in direction 1."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("tab", name="Loads & BCs").click()
    page.get_by_role("button", name="Cartesian constraint").wait_for()

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    for text in [
        'mesh.generate {"name": "bar", "tool": "Cube", '
        '"parameters": {"a": [0, 0, 0], "b": [3, 1, 1], "n": [4, 2, 2]}}',
        'cellset.from_file {"name": "cells", "mesh": "bar"}',
        'material.add {"name": "rubber", "model": "NeoHooke", '
        '"parameters": {"mu": 1, "bulk": 5}}',
        'section.add {"name": "solid", "cellset": "cells", "material": "rubber", '
        '"formulation": "u"}',
        'pointset.add {"name": "start", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "end", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "start", '
        '"constrained": ["x", "y", "z"]}',
        'cartesian.add {"name": "slide", "points": "end", "e1": [1, 0, 0], '
        '"e2": [0, 1, 0], "constrained": ["1"], "multiplier": 100000}',
        'step.add {"name": "tension", "ramp": {"num": 3, '
        '"items": [{"target": "slide", "end": 0.3}]}}',
        'job.add {"name": "job", "steps": ["tension"], "curve": "slide"}',
    ]:
        command(text)

    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("slide", exact=True).click()
    tree.get_by_text("end · 1 of e1 (1, 0, 0) e2 (0, 1, 0)").wait_for()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("tab", name="Script", exact=True).click()
    page.get_by_text("slide = fem.CartesianConstraint(").wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    assert "4 substeps" in summary and "Last substep: u1 = 0.3" in summary
    assert page.errors == []


def test_a_cylindrical_constraint_turned_and_recorded(url, page):
    """A cylindrical constraint (#422) at the end of a tube in a rigid sleeve, turned
    around its axis and recorded by the job: the ribbon has its button, the browser
    and the script show it, and the job panel shows the arc length and the force
    around the axis."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)
    page.get_by_role("tab", name="Loads & BCs").click()
    page.get_by_role("button", name="Cylindrical constraint").wait_for()

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    for text in [
        'mesh.generate {"name": "profile", "tool": "Rectangle", '
        '"parameters": {"a": [0, 1], "b": [3, 2], "n": [4, 2]}}',
        'mesh.generate {"name": "tube", "tool": "revolve", "inputs": ["profile"], '
        '"parameters": {"n": 13, "phi": 360, "axis": "x"}}',
        'cellset.from_file {"name": "cells", "mesh": "tube"}',
        'material.add {"name": "rubber", "model": "NeoHooke", '
        '"parameters": {"mu": 1, "bulk": 5}}',
        'section.add {"name": "solid", "cellset": "cells", "material": "rubber", '
        '"formulation": "u"}',
        'pointset.add {"name": "start", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "end", "select": {"axis": "x", "value": 3}}',
        'pointset.add {"name": "outside", "select": {"radius": 2, "axis": "x"}}',
        'boundary.add {"name": "fixed", "pointset": "start", '
        '"constrained": ["x", "y", "z"]}',
        'cylindrical.add {"name": "sleeve", "points": "outside", "axis": [1, 0, 0], '
        '"constrained": ["r"]}',
        'cylindrical.add {"name": "twist", "points": "end", "axis": [1, 0, 0], '
        '"constrained": ["theta"]}',
        'step.add {"name": "turn", "ramp": {"num": 3, '
        '"items": [{"target": "twist", "end": 0.3}]}}',
        'job.add {"name": "job", "steps": ["turn"], "curve": "twist"}',
    ]:
        command(text)

    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("twist", exact=True).click()
    tree.get_by_text("end · θ about (1, 0, 0)").wait_for()
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("tab", name="Script", exact=True).click()
    page.get_by_text("twist = fem.CylindricalConstraint(").wait_for(timeout=60_000)
    page.get_by_text("job = CylindricalCurve(").wait_for()

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    assert "4 substeps" in summary and "Last substep: uθ = 0.3" in summary
    assert "Fθ = " in summary
    assert page.errors == []


def test_a_material_of_a_script_solved(url, page):
    """A user-defined material of a Python file (ADR 0025): the template of a
    constitutive model, created with the ribbon, its file chosen in its properties,
    with the parameters of the model, and solved: the curve of the golden case."""
    page.goto(url)
    page.wait_for_selector("text=/ready, local Python/", timeout=60_000)

    def command(text):
        name = text.split('"name": "')[1].split('"')[0]
        line = page.get_by_label("Command", exact=True)
        line.fill(text)
        line.press("Enter")
        page.get_by_text(f"Created {name}.").first.wait_for(timeout=60_000)

    for text in [
        'parameter.add {"name": "mu", "value": 1.0}',
        'parameter.add {"name": "bulk", "value": 50.0}',
        'mesh.generate {"name": "bar", "tool": "Cube", '
        '"parameters": {"a": [0, 0, 0], "b": [3, 1, 1], "n": [13, 5, 5]}}',
        'cellset.from_file {"name": "cells", "mesh": "bar"}',
    ]:
        command(text)

    page.get_by_role("tab", name="Materials").click()
    page.get_by_role("button", name="User-defined material").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("Name", exact=True).fill("rubber")
    dialog.get_by_label("Script", exact=True).fill("material_constitutive.py")
    assert dialog.get_by_label("Volumetric part").is_checked()
    dialog.get_by_role("button", name="Create").click()
    tree = page.get_by_role("navigation", name="Model browser")
    tree.get_by_text("material_constitutive.py").wait_for()
    properties = page.get_by_role("region", name="Properties")
    properties.get_by_text("not loaded").wait_for()
    template = (
        Path(__file__).parents[2]
        / "python"
        / "felupe_studio"
        / "templates"
        / "material_constitutive.py"
    )
    page.get_by_test_id("mesh-file").set_input_files(str(template))
    properties.get_by_text("not loaded").wait_for(state="detached")

    for text in [
        'section.add {"name": "body", "cellset": "cells", "material": "rubber", '
        '"formulation": "u"}',
        'pointset.add {"name": "left", "select": {"axis": "x", "value": 0}}',
        'pointset.add {"name": "right", "select": {"axis": "x", "value": 3}}',
        'boundary.add {"name": "fixed", "pointset": "left", '
        '"constrained": ["x", "y", "z"]}',
        'boundary.add {"name": "move", "pointset": "right", "constrained": ["x"]}',
        'step.add {"name": "step_1", "ramp": {"num": 5, '
        '"items": [{"target": "move", "end": 0.5}]}}',
        'job.add {"name": "job_1", "steps": ["step_1"], "curve": "move"}',
    ]:
        command(text)
    page.get_by_text("0 issues", exact=True).wait_for(timeout=60_000)

    page.get_by_role("tab", name="Script", exact=True).click()
    page.get_by_text(
        'rubber = run_material_script("material_constitutive.py", {"mu": mu, "bulk": '
        "bulk})"
    ).wait_for(timeout=60_000)

    page.get_by_role("button", name="Solve").click()
    results = page.get_by_role("button", name="Show results")
    results.wait_for(timeout=120_000)
    summary = page.get_by_text("substeps in").first.inner_text()
    # the force of the golden case bar_material_script
    assert "6 substeps" in summary
    assert "Last substep: ux = 0.5, Fx = 0.4725" in summary
    assert page.errors == []
