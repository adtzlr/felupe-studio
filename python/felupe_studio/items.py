"""The parts of the script of the items besides the solid bodies (ADR 0018).

The multi-point constraints, the Cartesian and cylindrical constraints, the contacts
with rigid surfaces, the point loads and the pressures on face sets.
"""

from .cartesian import E2
from .directions import components, skip
from .formatting import Call, List, call, quote, vector


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


def base_vectors(context, command):
    """The rotation matrix of a Cartesian constraint as written: ``base_vectors()``
    of its e1 and e2, of a 2D model of e1 only (e2 is e1 turned by 90°)."""
    vectors = [command["e1"][: context.dim]]
    if context.dim == 3:
        vectors.append(command.get("e2", E2))
    return Call("rotation=base_vectors", [List(map(repr, v)) for v in vectors])


def local_args(context, command):
    """The arguments of a constraint in local coordinates (#421, #422) after its
    coordinate system: its displacement if not zero, the skipped directions and the
    multiplier if given."""
    args = []
    displacement = components(command, command.get("value", 0), context.dim)
    if any(float(v) != 0 for v in displacement):
        args.append(f"displacement={vector(displacement)}")
    skipped = skip(command, context.dim)
    if any(skipped):
        args.append(f"skip={skipped!r}")
    if "multiplier" in command:
        args.append(f"multiplier={command['multiplier']!r}")
    return args


def cartesian(context, command):
    """A Cartesian constraint (#421): the points of a point set in the directions of
    a rotated coordinate system, the skipped directions free."""
    args = [
        "field",
        f"points=np.flatnonzero({command['points']})",
        base_vectors(context, command),
        *local_args(context, command),
    ]
    return [call(command["name"], "fem.CartesianConstraint", args)]


def cylindrical(context, command):
    """A cylindrical constraint (#422): the points of a point set radially, around
    and along an axis, the skipped directions free. The center and the axis if
    written (the defaults of FElupe are the origin and z); in a 2D model, the axis is
    z."""
    args = ["field", f"points=np.flatnonzero({command['points']})"]
    if "center" in command:
        args.append(f"center={vector(command['center'][: context.dim])}")
    if "axis" in command and context.dim == 3:
        args.append(f"axis={vector(command['axis'])}")
    args += local_args(context, command)
    return [call(command["name"], "fem.CylindricalConstraint", args)]


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
CARTESIANS = {"cartesian.add": cartesian}
CYLINDRICALS = {"cylindrical.add": cylindrical}
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


def cartesians(context):
    """The part of the Cartesian constraints (#421)."""
    return context.emit(
        CARTESIANS,
        "# Cartesian constraints: the points held or moved in the directions of a\n"
        "# coordinate system (the columns of the rotation), the skipped ones free",
    )


def cylindricals(context):
    """The part of the cylindrical constraints (#422)."""
    return context.emit(
        CYLINDRICALS,
        "# cylindrical constraints: the points held or moved radially, around (the\n"
        "# arc length on the undeformed radius) and along an axis, the skipped ones\n"
        "# free",
    )


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
