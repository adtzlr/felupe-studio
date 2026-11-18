"""The bytecode cache of the Pyodide worker (ADR 0017).

Pyodide compiles the sources of every imported module at each start: neither its
packages nor the wheels of PyPI contain bytecode, and it does not write any. The
worker keeps the bytecode in IndexedDB (IDBFS at the folder of the cache). Python
writes it there with ``sys.pycache_prefix`` and reads it on the next start.

A ``.pyc`` file is valid for the modification time and the size of its source. The
worker unpacks the packages and writes the sources of felupe_studio at every start,
with new modification times, so they get a fixed one. The folder of the cache has a
key of the versions and of the sources, so another source never meets an old
``.pyc`` file of the same size.

The worker loads this module without the package, whose ``__init__`` would import
modules before the cache is enabled. So it imports only the standard library.
"""

import os
import sys

#: The fixed modification time of the sources, in seconds since the epoch.
MTIME = 1


def fix_mtimes(*roots):
    """Set the modification time of the Python sources below the folders to
    ``MTIME`` and return their number."""
    count = 0
    for root in roots:
        for folder, _, files in os.walk(root):
            for name in files:
                if name.endswith(".py"):
                    os.utime(os.path.join(folder, name), (MTIME, MTIME))
                    count += 1
    return count


def enable(prefix):
    """Write the bytecode of the modules imported from now on below the folder, and
    read it from there."""
    sys.pycache_prefix = prefix
    sys.dont_write_bytecode = False
