"""The parts of the script of the items besides the solid bodies (ADR 0018).

The multi-point constraints, the contacts with rigid surfaces, the point loads and
the pressures on face sets.
"""

from .formatting import List, call, quote, vector


def single_point(name):
    """The point of a point set of one point, e.g. a center point."""
    return f"single_point({name}, {quote(name)})"


def constraint(context, mpc):
    """A multi-point constraint."""
    args = [
        "field",
        f"points=np.flatnonzero({mpc['points']})",
        f"centerpoint={single_point(mpc['center'])}",
    ]
    skip = tuple(a not in mpc["constrained"] for a in context.axes)
    if any(skip):
        args.append(f"skip={skip!r}")
    if "multiplier" in mpc:
        args.append(f"multiplier={mpc['multiplier']!r}")
    if "rotation" in mpc:
        args.append(f"rotationpoint={single_point(mpc['rotation'])}")
    return [call(mpc["name"], "fem.MultiPointConstraint", args)]


def shape_args(context, shape):
    """The function and the arguments of the shape of a rigid surface: in a 2D model
    (#221), a plane is a line in the xy-plane and a cylinder a circle about z
    (without an axis)."""
    if "normal" in shape:
        normal = [float(x) for x in shape["normal"][: context.dim]]
        return "fem.ContactRigidPlane", [f"normal={normal!r}"]
    args = [f"radius={shape['radius']!r}"]
    if context.dim == 3:
        args.append(f"axis={[float(x) for x in shape['axis']]!r}")
    if shape.get("inside"):
        args.append("inside=True")
    return "fem.ContactRigidCylinder", args


def contact(context, command):
    """A contact of the points of a point set (of the sections) or of a face set with
    a rigid surface (#220)."""
    rigid = context.rigids[command["surface"]]
    if command["points"] in context.faceset_names:
        points = f"np.unique(region_{command['points']}.mesh.cells_faces)"
    else:
        points = f"np.intersect1d(np.flatnonzero({command['points']}), solid_points)"
    func, shape = shape_args(context, rigid["shape"])
    args = [
        "field",
        f"points={points}",
        f"centerpoint={single_point(rigid['name'])}",
        *shape,
    ]
    for key in ("friction", "multiplier", "elastic_slip"):
        if key in command:
            args.append(f"{key}={command[key]!r}")
    args.append(f"items={List(context.solids)}")
    return [call(command["name"], func, args)]


def load(context, command):
    """A point load: the force at every point of a point set, scaled by the ramps."""
    force = vector(context.components(command["force"], command["points"]))
    args = ["field", f"points={command['points']}", f"values={force}"]
    return [call(command["name"], "fem.PointLoad", args)]


def pressure(context, p):
    """A pressure on a face set, scaled by the ramps."""
    args = [f"field_{p['faces']}", f"pressure={p['pressure']!r}"]
    return [call(p["name"], "fem.SolidBodyPressure", args)]


CONSTRAINTS = {"mpc.add": constraint}
CONTACTS = {"contact.add": contact}
LOADS = {"load.add": load}
PRESSURES = {"pressure.add": pressure}


def constraints(context):
    """The part of the multi-point constraints."""
    comment = "# multi-point constraints"
    if context.dim == 2 and context.rotations:
        comment += (
            "\n# a rotation point of a 2D model: its first component is the rotation "
            "about z"
        )
    return context.emit(CONSTRAINTS, comment)


def contacts(context):
    """The part of the contacts with rigid surfaces, after the stiffness of the solid
    bodies for their penalties."""
    if not context.get("contact.add"):
        return []
    return [
        "\n# the stiffness of the solid bodies for the penalties of the contacts: "
        "without it,\n# a contact would assemble them with its field, which has the "
        "vertices of the\n# control points",
        f"for solid in {List(context.solids)}:",
        "    solid.assemble.matrix()",
        *context.emit(
            CONTACTS,
            "# contacts with rigid surfaces (#220): the points of a point set (of the "
            "sections)\n# or of a face set",
        ),
    ]


def loads(context):
    """The part of the point loads."""
    return context.emit(
        LOADS, "# point loads: the force at every point, scaled by the ramps"
    )


def pressures(context):
    """The part of the pressures on face sets."""
    return context.emit(
        PRESSURES,
        "# pressures on face sets: positive onto the faces, scaled by the ramps",
    )
