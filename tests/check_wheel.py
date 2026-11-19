"""Check an installed wheel of felupe-studio outside of a clone of the repository
(#275): the MCP server starts, and it offers the samples and the documents of the
package; felupe-studio serve serves the app of the package with its samples and a
local runtime (#240). Run it with the Python of a fresh environment, from another
folder:

    python -m venv /tmp/wheel && /tmp/wheel/bin/pip install "dist/<wheel>[mcp,serve]"
    cd /tmp && /tmp/wheel/bin/python <repository>/tests/check_wheel.py

(Not a test of pytest: it checks the installed package, not the sources.)"""

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

package = Path(felupe_studio.__file__).resolve().parent
data = package / "data"
# installed, not the sources of a clone
assert not (package.parents[1] / "app").exists(), package
assert mcp.DOCS == data / "docs", mcp.DOCS
assert mcp._samples_folder() == data / "samples", mcp._samples_folder()
for name in mcp.DOCUMENTS:
    assert (mcp.DOCS / f"{name}.md").is_file(), name

session = mcp.Session()
ids = [sample["id"] for sample in session.samples()]
assert "plate-with-hole" in ids and "engine-mount" in ids, ids
# the folders of the samples describe themselves (#350)
for sample in samples.read(data / "samples"):
    assert (data / "samples" / sample.folder / "sample.json").is_file(), sample
with tempfile.TemporaryDirectory() as folder:
    session.open_sample("plate-with-hole", Path(folder) / "plate")
    assert (Path(folder) / "plate" / "plate_with_hole.py").is_file()
    assert not session.issues()["errors"], session.issues()

subprocess.run(
    [sys.executable, "-m", "felupe_studio.mcp", "--help"],
    check=True,
    capture_output=True,
)
print(f"felupe-studio {felupe_studio.__version__}: {len(ids)} samples, the documents")

# the app of the package with the local runtime (#240)
from websockets.sync.client import connect  # noqa: E402

from felupe_studio import serve  # noqa: E402

app = data / "app"
assert serve.find_app() == app, serve.find_app()
assert serve.find_samples(app) == data / "samples", serve.find_samples(app)
assert not (app / "wheels").exists() and not (app / "samples").exists()
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
        assert serve.META in response.read().decode(), "the meta tag of the runtime"
    # the files of a sample from its folder (#350)
    # the list of the samples, made from their folder (#350)
    with urllib.request.urlopen(f"{base}/samples/index.json") as response:
        listed = json.loads(response.read())
    assert [s["id"] for s in listed] == ids, listed
    plate = samples.folder_of(data / "samples", "plate-with-hole").name
    with urllib.request.urlopen(f"{base}/samples/{plate}/model.felupe.json"):
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
