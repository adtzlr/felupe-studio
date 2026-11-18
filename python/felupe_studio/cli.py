"""The command ``felupe-studio``: ``felupe-studio serve`` starts the app with a local
Python runtime (#240, ADR 0014)."""

import argparse
import sys

from .__about__ import __version__


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="felupe-studio", description="FElupe Studio, with a local Python runtime."
    )
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser(
        "serve",
        help="serve the app on 127.0.0.1 with the Python of this computer",
        description="Serve the app on 127.0.0.1 and run its models with the Python "
        "of this computer instead of Pyodide. Mesh scripts run with your rights.",
    )
    serve.add_argument("--port", type=int, default=8765, help="the port (8765)")
    serve.add_argument(
        "--no-browser", action="store_true", help="do not open the app in a browser"
    )
    serve.add_argument(
        "--app", help="the folder of the built app (default: the app of the package)"
    )
    args = parser.parse_args(argv)
    if args.command == "serve":
        try:
            from .serve import find_app
            from .serve import serve as run
        except ImportError as error:
            sys.exit(
                f"{error}. The local runtime needs: pip install 'felupe-studio[serve]'"
            )
        try:
            find_app(args.app)
        except FileNotFoundError as error:
            sys.exit(str(error))
        try:
            run(port=args.port, app=args.app, browser=not args.no_browser)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
