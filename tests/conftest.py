def pytest_addoption(parser):
    parser.addoption(
        "--update-golden",
        action="store_true",
        help="Rewrite the expected scripts and results of the golden tests.",
    )


def pytest_configure(config):
    config.addinivalue_line("markers", "golden: golden tests (tests/golden)")
    config.addinivalue_line(
        "markers", "e2e: the app in a browser with felupe-studio serve (tests/e2e)"
    )
