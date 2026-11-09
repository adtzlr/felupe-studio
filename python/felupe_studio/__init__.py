"""Command interpretation and code generation for FElupe Studio.

The command list of the GUI is turned into a readable FElupe script by this
package. It runs unchanged in Pyodide (browser) and in CPython (tests).
"""

from .__about__ import __version__

__all__ = ["__version__", "versions"]


def versions():
    """Return the versions of felupe-studio and of the packages it builds on."""
    import felupe
    import numpy
    import scipy

    return {
        "felupe-studio": __version__,
        "felupe": felupe.__version__,
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
    }
