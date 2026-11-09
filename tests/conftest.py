def pytest_addoption(parser):
    parser.addoption(
        "--update-golden",
        action="store_true",
        help="Rewrite the expected scripts and results of the golden tests.",
    )


def pytest_configure(config):
    config.addinivalue_line("markers", "golden: golden tests (tests/golden)")
