import hashlib
import json
from pathlib import Path

import felupe

import felupe_studio

ROOT = Path(__file__).parents[1]


def test_versions():
    v = felupe_studio.versions()
    assert v["felupe-studio"] == felupe_studio.__version__
    assert int(v["felupe"].split(".")[0]) >= 12


def test_app_and_package_have_the_same_version():
    "The app and the Python package are released together (docs/release.md)."
    app = json.loads((ROOT / "app" / "package.json").read_text())
    lock = json.loads((ROOT / "app" / "package-lock.json").read_text())
    assert app["version"] == felupe_studio.__version__
    assert lock["version"] == lock["packages"][""]["version"] == app["version"]


def test_vendored_viewer_is_felupes():
    "The vendored viewer is an unmodified copy of the viewer of the pinned FElupe."
    pinned = json.loads((ROOT / "app" / "package.json").read_text())
    version = pinned["config"]["wheels"]["felupe"]["version"]
    vendor = ROOT / "app" / "src" / "vendor" / "felupe-viewer"
    readme = (vendor / "README.md").read_text()
    copy = (vendor / "viewer.js").read_bytes()

    assert f"FElupe {version}" in readme
    assert f"`{hashlib.sha256(copy).hexdigest()}`" in readme
    if felupe.__version__ == version:
        source = Path(felupe.__file__).parent / "view/_backends/_webgl/viewer.js"
        assert source.read_bytes() == copy
