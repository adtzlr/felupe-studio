"""Check an installed wheel of felupe-studio outside of a clone of the repository
(#275): the MCP server starts, and it offers the samples and the documents of the
package; felupe-studio serve serves the app of the package with its samples and a
local runtime (#240). Run it with the Python of a fresh environment, from another
folder:

    python -m venv /tmp/wheel && /tmp/wheel/bin/pip install "dist/<wheel>[mcp,serve]"
    cd /tmp && /tmp/wheel/bin/python <repository>/tests/check_wheel.py [<brand folder>]

The wheel has the app and the samples of the brand it was built with (#321, ADR
0020): the brand folder, else that of FElupe Studio (``app/brand``), gives the name
of the app and the samples to expect.

(Not a test of pytest: it checks the installed package, not the sources.)"""

import html
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import felupe_studio
from felupe_studio import mcp, samples

REPOSITORY = Path(__file__).resolve().parents[1]
BRAND = (
    Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPOSITORY / "app" / "brand"
)
brand = json.loads((BRAND / "brand.json").read_text(encoding="utf-8"))
# the samples of the brand in their order (#350); a brand may have none
expected = (
    [s.id for s in samples.read(BRAND / brand["samples"])] if "samples" in brand else []
)

package = Path(felupe_studio.__file__).resolve().parent
data = package / "data"
# the samples of the build in the package, if the brand has samples
folder = data / "samples" if expected else None
# installed, not the sources of a clone
assert not (package.parents[1] / "app").exists(), package
assert mcp.DOCS == data / "docs", mcp.DOCS
assert mcp._samples_folder() == folder, mcp._samples_folder()
for name in mcp.DOCUMENTS:
    assert (mcp.DOCS / f"{name}.md").is_file(), name

session = mcp.Session()
ids = [sample["id"] for sample in session.samples()]
assert ids == expected, (ids, expected)
# the folders of the samples describe themselves (#350)
listed = samples.read(folder) if folder else []
for sample in listed:
    assert (folder / sample.folder / "sample.json").is_file(), sample
# a sample with its files: a mesh script (e.g. the plate with a hole), else a file
sample = next(
    (s for s in listed if any(name.endswith(".py") for name in s.files)),
    next((s for s in listed if s.files), listed[0] if listed else None),
)
if sample:
    with tempfile.TemporaryDirectory() as target:
        session.open_sample(sample.id, Path(target) / "sample")
        for name in sample.files:
            assert (Path(target) / "sample" / name).is_file(), name
        assert not session.issues()["errors"], session.issues()

subprocess.run(
    [sys.executable, "-m", "felupe_studio.mcp", "--help"],
    check=True,
    capture_output=True,
)
print(
    f"felupe-studio {felupe_studio.__version__} ({brand['name']}): {len(ids)} "
    "samples, the documents"
)

# the app of the package with the local runtime (#240)
from websockets.sync.client import connect  # noqa: E402

from felupe_studio import serve  # noqa: E402

app = data / "app"
assert serve.find_app() == app, serve.find_app()
assert serve.find_samples(app) == folder, serve.find_samples(app)
for name in ("wheels", "pyodide", "samples"):
    assert not (app / name).exists(), name
# the samples of the build, without their list, which serve makes (#350)
assert not (data / "samples" / "index.json").exists()
# the command of the package
command = Path(sys.executable).parent / "felupe-studio"
version = subprocess.run(
    [command, "--version"], check=True, capture_output=True, text=True
).stdout.strip()
assert version == felupe_studio.__version__, version
server = subprocess.Popen(
    [command, "serve", "--no-browser", "--port", "8766"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
try:
    line = server.stdout.readline()
    url = re.search(r"http://\S+", line).group(0)
    token = url.split("token=")[1]
    base = "http://127.0.0.1:8766"
    with urllib.request.urlopen(f"{base}/") as response:
        page = response.read().decode()
    assert serve.META in page, "the meta tag of the runtime"
    # the app of the brand (#321)
    title = f"<title>{html.escape(brand['name'], quote=False)}</title>"
    assert title in page, title
    # the list of the samples, made from their folder (#350)
    with urllib.request.urlopen(f"{base}/samples/index.json") as response:
        index = json.loads(response.read())
    assert [s["id"] for s in index] == ids, index
    # the files of a sample from its folder (#350)
    if sample:
        model = f"{base}/samples/{sample.folder}/model.felupe.json"
        with urllib.request.urlopen(model):
            pass
    start = time.perf_counter()
    with connect(f"ws://127.0.0.1:8766/runtime?token={token}") as websocket:
        ready = json.loads(websocket.recv())
        assert ready["type"] == "ready", ready
        assert ready["versions"]["felupe_studio"] == felupe_studio.__version__
    print(
        f"felupe-studio serve: {url.split('?')[0]}, ready in "
        f"{time.perf_counter() - start:.1f} s"
    )
finally:
    server.terminate()
    server.wait()
