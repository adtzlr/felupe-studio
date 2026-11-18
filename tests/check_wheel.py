"""Check an installed wheel of felupe-studio outside of a clone of the repository
(#275): the MCP server starts, and it offers the samples and the documents of the
package. Run it with the Python of a fresh environment, from another folder:

    python -m venv /tmp/wheel && /tmp/wheel/bin/pip install "dist/<wheel>[mcp]"
    cd /tmp && /tmp/wheel/bin/python <repository>/tests/check_wheel.py

(Not a test of pytest: it checks the installed package, not the sources.)"""

import subprocess
import sys
import tempfile
from pathlib import Path

import felupe_studio
from felupe_studio import mcp

package = Path(felupe_studio.__file__).resolve().parent
data = package / "data"
# installed, not the sources of a clone
assert not (package.parents[1] / "app").exists(), package
assert mcp.INDEX == data / "samples.json", mcp.INDEX
assert mcp.DOCS == data / "docs", mcp.DOCS
assert mcp._samples_folder() == data / "samples", mcp._samples_folder()
for name in mcp.DOCUMENTS:
    assert (mcp.DOCS / f"{name}.md").is_file(), name

session = mcp.Session()
ids = [sample["id"] for sample in session.samples()]
assert "plate-with-hole" in ids and "engine-mount" in ids, ids
for sample in ids:
    assert (data / "samples" / sample / "model.felupe.json").is_file(), sample
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
