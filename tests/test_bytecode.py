"""The bytecode cache of the Pyodide worker (ADR 0017): fixed modification times of
the sources keep the ``.pyc`` files below ``sys.pycache_prefix`` valid for the next
start, which writes the same sources again."""

import os
import subprocess
import sys
from pathlib import Path

from felupe_studio import bytecode

SOURCE = Path(bytecode.__file__)


def test_fix_mtimes(tmp_path):
    (tmp_path / "package" / "sub").mkdir(parents=True)
    for name in ("package/__init__.py", "package/sub/module.py", "package/data.json"):
        (tmp_path / name).write_text("x = 1\n")
    assert bytecode.fix_mtimes(tmp_path / "package", tmp_path / "missing") == 2
    assert os.stat(tmp_path / "package" / "sub" / "module.py").st_mtime == 1
    assert os.stat(tmp_path / "package" / "data.json").st_mtime != 1


def start(tmp_path, written, fix=True):
    """A start of the worker: write the sources (at the time ``written``), fix their
    modification times, enable the cache, import. Return the modification time of
    the .pyc file."""
    package = tmp_path / "site" / "demo"
    package.mkdir(parents=True, exist_ok=True)
    (package / "__init__.py").write_text("VALUE = 42\n")
    os.utime(package / "__init__.py", (written, written))
    fixed = f"b.fix_mtimes({str(package)!r})\n" if fix else ""
    code = (
        # the worker loads the module without the package (no __init__)
        "import importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('b', {str(SOURCE)!r})\n"
        "b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)\n"
        f"{fixed}"
        f"b.enable({str(tmp_path / 'cache')!r})\n"
        f"sys.path.insert(0, {str(tmp_path / 'site')!r})\n"
        "import demo; assert demo.VALUE == 42\n"
        "print(demo.__cached__)\n"
    )
    # like Pyodide, which does not write bytecode by default
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, env=env
    )
    assert out.returncode == 0, out.stderr
    cached = Path(out.stdout.strip())
    assert cached.is_relative_to(tmp_path / "cache") and cached.is_file()
    return cached.stat().st_mtime_ns


def test_the_bytecode_of_a_start_is_valid_for_the_next_one(tmp_path):
    first = start(tmp_path, written=1000)
    # the next start writes the source again: the .pyc file is read, not rewritten
    assert start(tmp_path, written=2000) == first
    assert not (tmp_path / "site" / "demo" / "__pycache__").exists()
    # without the fixed modification time, it would be compiled again
    assert start(tmp_path, written=3000, fix=False) != first
