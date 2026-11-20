"""The built app and its samples in the wheel, for felupe-studio serve (#240, ADR
0014) and the MCP server.

``npm run build`` in ``app/`` makes ``app/dist``. The wheel gets it as
``felupe_studio/data/app``, without the wheels of Pyodide and a self-hosted Pyodide
(the local runtime does not load Pyodide, ADR 0020) and without the samples. The
samples are ``felupe_studio/data/samples``: those of the build
(``app/dist/samples``, the folder of ``SAMPLES_DIR`` or ``app/samples``, #350), else
``app/samples``. The server serves them and makes their list, and the MCP server
offers them. Without a built app the wheel has no app, unless
``FELUPE_STUDIO_REQUIRE_APP`` is set (a release): then the build fails.
"""

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

LEFT_OUT = ("wheels", "pyodide", "samples")
"""The folders of the built app that the wheel leaves out of its app."""


def _include(build_data, folder, target, skip=()):
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(folder)
        if path.is_file() and relative.parts[0] not in skip:
            build_data["force_include"][str(path)] = f"{target}/{relative.as_posix()}"


class AppBuildHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version, build_data):
        if self.target_name != "wheel":
            return
        app = Path(self.root) / "app"
        dist = app / "dist"
        built = (dist / "index.html").is_file()
        if built:
            _include(build_data, dist, "felupe_studio/data/app", skip=LEFT_OUT)
        elif os.environ.get("FELUPE_STUDIO_REQUIRE_APP"):
            raise RuntimeError(
                "The built app is missing: run `npm ci && npm run build` in app/."
            )
        else:
            self.app.display_warning(
                "The wheel has no app for felupe-studio serve: app/dist is missing."
            )
        # the folders of the samples of the build, without its list (serve makes it)
        samples = dist / "samples" if built else app / "samples"
        if samples.is_dir():
            for folder in sorted(p for p in samples.iterdir() if p.is_dir()):
                target = f"felupe_studio/data/samples/{folder.name}"
                _include(build_data, folder, target)
