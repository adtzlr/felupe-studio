import felupe_studio


def test_versions():
    v = felupe_studio.versions()
    assert v["felupe-studio"] == felupe_studio.__version__
    assert int(v["felupe"].split(".")[0]) >= 12
