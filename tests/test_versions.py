import hashlib
import json
import re
import tomllib
from pathlib import Path

import felupe
from packaging.requirements import Requirement

import felupe_studio
from felupe_studio.runner import LAZY_WHEELS

ROOT = Path(__file__).parents[1]


def test_versions():
    v = felupe_studio.versions()
    assert v["felupe-studio"] == felupe_studio.__version__
    assert int(v["felupe"].split(".")[0]) >= 12
    assert v["felupe-contact"]


def test_pins_of_felupe_contact():
    """The wheel of the app and CI pin the same version of felupe-contact, which the
    dependency of the package takes (#461, docs/release.md)."""
    app = json.loads((ROOT / "app" / "package.json").read_text())
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())

    wheel = app["config"]["wheels"]["felupe-contact"]
    pinned = re.search(r'FELUPE_CONTACT_VERSION: "(.+)"', ci).group(1)
    (dependency,) = [
        Requirement(r)
        for r in project["project"]["dependencies"]
        if Requirement(r).name == "felupe-contact"
    ]

    assert wheel["version"] == pinned
    assert wheel["lazy"]
    assert dependency.specifier.contains(pinned)


def test_lazy_wheels_of_the_app_are_the_runners():
    "The worker loads the lazy wheels that the runner names (#461)."
    app = json.loads((ROOT / "app" / "package.json").read_text())
    lazy = [name for name, w in app["config"]["wheels"].items() if w.get("lazy")]
    assert sorted(lazy) == sorted(LAZY_WHEELS)


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
