"""Command interpretation and code generation for FElupe Studio.

The command list of the GUI is turned into a readable FElupe script by this
package. It runs unchanged in Pyodide (browser) and in CPython (tests).
"""

from .__about__ import __version__
from .codegen import codegen

__all__ = ["__version__", "codegen", "versions"]


def versions():
    """Return the versions of felupe-studio and of the packages it builds on."""
    from importlib.metadata import version

    import felupe
    import numpy
    import scipy

    return {
        "felupe-studio": __version__,
        "felupe": felupe.__version__,
        # the contact between bodies (#461), without importing it
        "felupe-contact": version("felupe-contact"),
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
    }
