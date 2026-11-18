"""The built app in the wheel, for felupe-studio serve (#240, ADR 0014).

``npm run build`` in ``app/`` makes ``app/dist``. The wheel gets it as
``felupe_studio/data/app``, without the wheels of Pyodide (the local runtime does
not load Pyodide) and without the samples (the package has them in
``felupe_studio/data/samples``, which the server serves). Without a built app the
wheel has no app, unless ``FELUPE_STUDIO_REQUIRE_APP`` is set (a release): then the
build fails.
"""

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

LEFT_OUT = ("wheels", "samples")
"""The folders of the built app that the wheel leaves out."""


class AppBuildHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version, build_data):
        if self.target_name != "wheel":
            return
        dist = Path(self.root) / "app" / "dist"
        if not (dist / "index.html").is_file():
            if os.environ.get("FELUPE_STUDIO_REQUIRE_APP"):
                raise RuntimeError(
                    "The built app is missing: run `npm ci && npm run build` in app/."
                )
            self.app.display_warning(
                "The wheel has no app for felupe-studio serve: app/dist is missing."
            )
            return
        for path in sorted(dist.rglob("*")):
            relative = path.relative_to(dist)
            if path.is_file() and relative.parts[0] not in LEFT_OUT:
                target = f"felupe_studio/data/app/{relative.as_posix()}"
                build_data["force_include"][str(path)] = target
