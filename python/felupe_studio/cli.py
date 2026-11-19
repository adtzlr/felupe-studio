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
        "of this computer instead of Pyodide. Mesh scripts run with your rights. The "
        "token of the link is new at every start, or the one of the environment "
        "variable FELUPE_STUDIO_TOKEN (at least 16 letters, digits, _ or -).",
    )
    serve.add_argument("--port", type=int, default=8765, help="the port (8765)")
    serve.add_argument(
        "--no-browser", action="store_true", help="do not open the app in a browser"
    )
    serve.add_argument(
        "--app", help="the folder of the built app (default: the app of the package)"
    )
    serve.add_argument(
        "--agent",
        action="store_true",
        help="also offer an MCP endpoint, by which AI agents act on the open app",
    )
    args = parser.parse_args(argv)
    if args.command == "serve":
        try:
            from .serve import find_app, read_samples, token_of
            from .serve import serve as run
        except ImportError as error:
            sys.exit(
                f"{error}. The local runtime needs: pip install 'felupe-studio[serve]'"
            )
        if args.agent:
            try:
                from . import bridge  # noqa: F401
            except ImportError as error:
                sys.exit(
                    f"{error}. The agent bridge needs: "
                    "pip install 'felupe-studio[serve,mcp]'"
                )
        try:
            # the folder of samples of the app, checked at the start (#350)
            read_samples(find_app(args.app))
            # the token of FELUPE_STUDIO_TOKEN, or a new one
            token = token_of()
        except (FileNotFoundError, ValueError) as error:
            sys.exit(str(error))
        try:
            run(
                port=args.port,
                app=args.app,
                browser=not args.no_browser,
                token=token,
                agent=args.agent,
            )
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
