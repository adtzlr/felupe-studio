"""Load cases of FElupe (``fem.dof``) on the merged field.

A ``loadcase.add`` command creates the boundaries of a standard test with
``fem.dof.uniaxial``, ``fem.dof.biaxial`` (also for planar tension, where the second
axis does not move) or ``fem.dof.shear``. The load case is created without a
displacement (``move=0``); a step ramps its moving end faces. In the boundaries of
the script, the boundaries of a load case are named ``<load case>/<key>``.
"""

AXES = ("x", "y", "z")

DEFAULTS = {"axis": "x", "second": "y", "normal": "y"}


def _axis(loadcase, key):
    return AXES.index(loadcase.get(key, DEFAULTS[key]))


def loadcase_call(loadcase):
    """Return the function and the arguments of a ``loadcase.add`` command.

    Examples
    --------
    >>> loadcase_call({"type": "uniaxial", "axis": "z", "clamped": True})
    ('fem.dof.uniaxial', ['field', 'axis=2', 'clamped=True', 'move=0.0'])
    """
    kind = loadcase["type"]
    args = ["field"]
    if kind == "uniaxial":
        args.append(f"axis={_axis(loadcase, 'axis')}")
        if "clamped" in loadcase:
            args.append(f"clamped={loadcase['clamped']!r}")
        if "symmetry" in loadcase:
            args.append(f"sym={loadcase['symmetry']!r}")
        return "fem.dof.uniaxial", [*args, "move=0.0"]

    if kind in ("biaxial", "planar"):
        axes = (_axis(loadcase, "axis"), _axis(loadcase, "second"))
        args.append(f"axes={axes!r}")
        if "clamped" in loadcase:
            clamped = loadcase["clamped"]
            args.append(f"clampes={(clamped, clamped)!r}")
        if "symmetry" in loadcase:
            args.append(f"sym={loadcase['symmetry']!r}")
        return "fem.dof.biaxial", [*args, "moves=(0.0, 0.0)"]

    if kind == "shear":
        axes = (_axis(loadcase, "axis"), _axis(loadcase, "normal"))
        args.append(f"axes={axes!r}")
        if "symmetry" in loadcase:
            args.append(f"sym={loadcase['symmetry']!r}")
        compression = float(loadcase.get("compression", 0.0))
        return "fem.dof.shear", [*args, f"moves=(0.0, 0.0, {compression!r})"]

    raise ValueError(f"Unknown load case '{kind}'.")


def moving(loadcase):
    """Return the keys of the boundaries of a load case that a step ramps, with the
    sign of their displacement (the opposite end faces of a biaxial load case without
    symmetry move backwards). The first one gives the characteristic curve.

    Examples
    --------
    >>> moving({"type": "biaxial", "symmetry": False})
    [('move-right-0', 1), ('move-right-1', 1), ('move-left-0', -1), ('move-left-1', -1)]
    """
    kind = loadcase["type"]
    if kind in ("uniaxial", "shear"):
        return [("move", 1)]
    axes = [_axis(loadcase, "axis")]
    if kind == "biaxial":
        axes.append(_axis(loadcase, "second"))
    keys = [(f"move-right-{a}", 1) for a in axes]
    if not loadcase.get("symmetry", True):
        keys += [(f"move-left-{a}", -1) for a in axes]
    return keys


def problems(loadcase):
    """Return the problems of a load case (e.g. the same axis twice)."""
    kind = loadcase["type"]
    other = {"biaxial": "second", "planar": "second", "shear": "normal"}.get(kind)
    if other and _axis(loadcase, "axis") == _axis(loadcase, other):
        return [
            f"load case '{loadcase['name']}' needs different axes for "
            f"'axis' and '{other}'."
        ]
    if (
        kind != "shear"
        and not loadcase.get("symmetry", True)
        and not loadcase.get("clamped", False)
    ):
        return [
            f"load case '{loadcase['name']}' needs symmetry planes or clamped end "
            "faces, otherwise the transversal displacements are free."
        ]
    return []
