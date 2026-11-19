"""The parts of the script of the sets and the boundaries (ADR 0018).

The point sets of the merged mesh, the face sets of the sections, the load cases and
the symmetry planes (``fem.dof``) and the dict of the boundaries on the merged field.
"""

from .formatting import List, call, offset, quote, vector, wrap
from .loadcases import loadcase_call, symmetry_call

AXES = ("x", "y", "z")


def solid_points(context):
    """The points of the cells of the sections, not the control points: for the
    bounds of point sets (#181) and the points of contacts (#220)."""
    cells = [f"region_{sec['name']}.mesh.cells" for sec in context.sections]
    if len(cells) == 1:
        return [call("solid_points", "np.unique", cells)]
    return [
        call("solid_points", "np.concatenate", [List(cells), "axis=None"]),
        "solid_points = np.unique(solid_points)",
    ]


def vertex(context, point):
    """The point set of a control point or of the reference point of a rigid surface
    (#219): a point set of one point."""
    coordinates = vector(point["coordinates"][: context.dim])
    return [call(point["name"], "points_at", ["points", coordinates])]


def isclose(context, name, sel):
    """A point set of the points at a coordinate, at a bound of the coordinates of the
    solid points (#181) or at a distance to an axis."""
    atol = f"atol={sel.get('atol', 1e-8)!r}"
    if "value" in sel:
        axis = AXES.index(sel["axis"])
        args = [f"points[:, {axis}]", repr(sel["value"]), atol]
    elif "bound" in sel:
        axis = AXES.index(sel["axis"])
        bound = f"points[solid_points, {axis}].{sel['bound']}()"
        args = [f"points[:, {axis}]", bound, atol]
    else:
        # the distance to the axis in the plane normal to it
        center = sel.get("center", [0, 0, 0])
        others = [k for k in range(3) if k != AXES.index(sel["axis"])]
        distances = [offset(f"points[:, {k}]", center[k]) for k in others]
        args = [f"np.hypot({', '.join(distances)})", repr(sel["radius"]), atol]
    return [call(name, "np.isclose", args)]


def pointset(context, ps):
    """A point set of the merged mesh, by its selection."""
    name, sel = ps["name"], ps["select"]
    if any(key in sel for key in ("value", "bound", "radius")):
        return isclose(context, name, sel)
    if "surface" in sel:
        # the points of the faces of one cell (of the edges of 2D cells)
        meshes = List(f"region_{sec['name']}.mesh" for sec in context.sections)
        return [call(name, "surface_points", [meshes, "points"])]
    if "section" in sel:
        # the points of the cells of a section, e.g. of a rigid part (#241)
        cells = f"region_{sel['section']}.mesh.cells"
        return [call(name, "np.isin", ["np.arange(len(points))", cells])]
    if "points" in sel:
        # the points of a 2D model in the xy-plane (#175)
        coordinates = List(vector(p[: context.dim]) for p in sel["points"])
        args = ["points", coordinates]
        if "atol" in sel:
            args.append(f"atol={sel['atol']!r}")
        return [call(name, "points_at", args)]
    return [
        call(name, "np.zeros", ["len(points)", "dtype=bool"]),
        f"{name}[{sel['ids']!r}] = True",
    ]


def faceset(context, fs):
    """A face set: a boundary region of the merged mesh of a section (#142), with a
    field container linked to the top-level field."""
    mesh, sel = f"region_{fs['section']}.mesh", fs["select"]
    if "axis" in sel:
        args = [mesh, f"plane=({AXES.index(sel['axis'])}, {sel['value']!r})"]
    else:
        # the centers of the edges of 2D cells in the xy-plane (#175)
        centers = (vector(c[: context.dim]) for c in sel["centers"])
        args = [mesh, List(centers, prefix="centers=")]
    if "atol" in sel:
        args.append(f"atol={sel['atol']!r}")
    region = f"region_{fs['name']}"
    return [
        call(region, "boundary_faces", args, context.astype),
        context.container(f"field_{fs['name']}", region),
        f"field_{fs['name']}.link(field)",
    ]


def loadcase(context, lc):
    """A load case (``fem.dof``), ramped by the steps."""
    return [call(lc["name"], *loadcase_call(lc))]


def symmetry(context, sym):
    """A symmetry plane (#186): boundaries of all steps."""
    return [call(sym["name"], *symmetry_call(sym, context.dim))]


def boundary(context, bc):
    """The entry of a boundary in the dict of the boundaries."""
    args = ["field[0]", f"mask={bc['pointset']}"]
    constrained = bc["constrained"]
    # in a 2D model (#175), the rotation about z is the first component of a rotation
    # point (FElupe locks the second one)
    if context.dim == 2 and bc["pointset"] in context.rotations:
        constrained = ["x"] if "z" in constrained else []
    skip = tuple(0 if a in constrained else 1 for a in context.axes)
    if any(skip):
        args.append(f"skip={skip!r}")
    # one value for all constrained components, or one per component (#225)
    value = bc.get("value", 0)
    if any(value) if isinstance(value, list) else value != 0:
        args.append(f"value={value!r}")
    return [wrap(f"{quote(bc['name'])}: fem.Boundary", args, level=1, end=",")]


def dof_entries(name):
    """The entries of the boundaries of a load case or a symmetry plane."""
    return f'    **{{f"{name}/{{k}}": v for k, v in {name}.items()}},'


POINTSETS = {"point.add": vertex, "rigid.add": vertex, "pointset.add": pointset}
FACESETS = {"faceset.add": faceset}
LOADCASES = {"loadcase.add": loadcase}
SYMMETRIES = {"symmetry.add": symmetry}
BOUNDARIES = {"boundary.add": boundary}


def pointsets(context):
    """The part of the point sets of the merged mesh, with the control points and the
    reference points of the rigid surfaces (a point set of one point each, #219)."""
    if not context.pointsets:
        return []
    lines = [
        "\n# point sets of the merged mesh",
        "points = field.mesh_container.points",
    ]
    if context.needs_solid_points:
        lines += solid_points(context)
    for ps in context.pointsets:
        lines += POINTSETS[ps["command"]](context, ps)
    return lines


def facesets(context):
    """The part of the face sets: boundary regions of the merged meshes of the
    sections (#142)."""
    if context.dim == 2:
        comment = (
            "# face sets: the faces of the sections (the edges of 2D cells), with a "
            "field each"
        )
    else:
        comment = "# face sets: the faces of the sections, with a field each"
    return context.emit(FACESETS, comment)


def loadcases(context):
    """The part of the load cases and of the symmetry planes (``fem.dof``)."""
    return [
        *context.emit(LOADCASES, "# load cases (fem.dof), ramped by the steps"),
        *context.emit(SYMMETRIES, "# symmetry planes (fem.dof)"),
    ]


def boundaries(context):
    """The part of the dict of the boundaries, with those of the load cases and of
    the symmetry planes (after the boundaries)."""
    names = [*context.loadcases, *(sym["name"] for sym in context.symmetries)]
    lines = context.emit(BOUNDARIES) + [dof_entries(name) for name in names]
    if not lines:
        return ["\n# boundaries", "boundaries = {}"]
    return ["\n# boundaries", "boundaries = {", *lines, "}"]
