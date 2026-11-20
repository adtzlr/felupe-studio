"""The brands of upstream (brands/, #321, ADR 0020).

- The example brand: its samples are valid project files of their own, made with
  the mesh tools, and solve with FElupe. CI builds the brand and checks it in a
  browser (tests/e2e/test_example_brand.py) and its wheel (tests/check_wheel.py
  brands/example).
- The CI files of a brand build the same release, like the workflows of upstream.
"""

import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

from felupe_studio import samples
from felupe_studio.commands import errors
from felupe_studio.project import dumps, loads
from felupe_studio.runner import run

ROOT = Path(__file__).parents[1]
BRAND = ROOT / "brands" / "example"
SAMPLES = samples.read(BRAND / "samples")

sys.path.insert(0, str(ROOT / "app" / "scripts"))

from make_samples import thumbnail  # noqa: E402
from make_thumbnails import main as make_thumbnails  # noqa: E402


def test_the_samples_are_its_own():
    "Two samples that upstream does not have, each describing itself."
    brand = json.loads((BRAND / "brand.json").read_text(encoding="utf-8"))
    assert brand["samples"] == "samples" and brand["pyodide"] == "self-hosted"
    assert [s.id for s in SAMPLES] == ["rubber-pad", "rubber-strip"]
    upstream = {s.id for s in samples.read(ROOT / "app" / "samples")}
    assert not upstream & {s.id for s in SAMPLES}
    for sample in SAMPLES:
        assert sample.title and sample.description and sample.topics
        assert sample.thumbnail and sample.files == ()


@pytest.mark.parametrize("sample", SAMPLES, ids=[s.id for s in SAMPLES])
def test_sample_solves(sample, monkeypatch):
    folder = BRAND / "samples" / sample.folder
    text = (folder / "model.felupe.json").read_text(encoding="utf-8")
    document = loads(text)
    assert dumps(document) == text
    assert errors(document) == []
    monkeypatch.chdir(folder)
    result = run(document)["job"]
    assert result["substeps"] == 7
    force = np.array(result["y"])
    assert np.all(np.isfinite(force)) and np.abs(force[-1]).max() > 0
    # the picture of the sample is made from its project, like those of upstream
    svg = (folder / "thumbnail.svg").read_text(encoding="utf-8")
    assert svg == thumbnail(folder), (
        "Run python app/scripts/make_thumbnails.py brands/example/samples."
    )


def test_make_thumbnails(tmp_path, capsys):
    "The pictures of a folder of samples, e.g. of a brand, from their projects."
    folder = tmp_path / "samples"
    shutil.copytree(BRAND / "samples", folder)
    for sample in SAMPLES:
        (folder / sample.folder / "thumbnail.svg").unlink()
    make_thumbnails(folder)
    for sample in SAMPLES:
        made = (folder / sample.folder / "thumbnail.svg").read_text(encoding="utf-8")
        svg = BRAND / "samples" / sample.folder / "thumbnail.svg"
        assert made == svg.read_text(encoding="utf-8")
    assert capsys.readouterr().out.count("thumbnail.svg") == len(SAMPLES)


def test_the_strip_is_in_simple_shear(monkeypatch):
    "The shear force of the strip: mu * gamma * length per unit thickness."
    folder = BRAND / "samples" / samples.find(SAMPLES, "rubber-strip").folder
    monkeypatch.chdir(folder)
    result = run(loads((folder / "model.felupe.json").read_text()))["job"]
    assert result["y"][-1][0] == pytest.approx(0.5 * 1.0 * 50, rel=1e-3)


TEMPLATES = [ROOT / "brands" / "gitlab-ci.yml", ROOT / "brands" / "github-actions.yml"]


def setting(text, name):
    return re.search(rf'^  {name}: "?([^"\n]+)"?$', text, re.MULTILINE).group(1)


def test_the_ci_files_build_one_release():
    "The same release and brand folder; the release workflow checks the version."
    texts = [path.read_text(encoding="utf-8") for path in TEMPLATES]
    versions = {setting(text, "FELUPE_STUDIO_VERSION") for text in texts}
    assert len(versions) == 1, versions
    assert {setting(text, "BRAND_FOLDER") for text in texts} == {"brand"}
    for text in texts:
        # the wheel of the brand, checked like that of a release
        assert "FELUPE_STUDIO_REQUIRE_APP=1 python -m build --wheel" in text
        assert "tests/check_wheel.py" in text
    # the page of a deployment names the same release
    page = (ROOT / "docs" / "deployment.md").read_text(encoding="utf-8")
    named = set(re.findall(r"(?:/v|felupe_studio-|: \")(\d+\.\d+\.\d+)", page))
    assert named == versions, named
    release = (ROOT / ".github" / "workflows" / "release.yml").read_text()
    for path in TEMPLATES:
        assert f"brands/{path.name}" in release


def test_the_github_workflow_uses_the_actions_of_upstream():
    "The versions of the actions are those of the workflows of felupe-studio."
    used = {}
    for path in (ROOT / ".github" / "workflows").glob("*.yml"):
        for action, version in re.findall(r"uses: ([\w/-]+)@(\S+)", path.read_text()):
            used.setdefault(action, set()).add(version)
    text = (ROOT / "brands" / "github-actions.yml").read_text(encoding="utf-8")
    for action, version in re.findall(r"uses: ([\w/-]+)@(\S+)", text):
        assert used.get(action) == {version}, (action, version, used.get(action))
