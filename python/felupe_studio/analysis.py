"""The type of the analysis of a model (#175): 3D, or 2D as plane strain or
axisymmetric, and the rules of a 2D model, like ``app/src/core/analysis.ts``.

A 2D model has 2D cells and no z components, except the rotation about z of the
rotation points of the constraints. The rule of a command type (:data:`PLANAR`) is a
function ``(command, analysis, rotations) -> problems`` that returns the first
problem of the command.
"""

# the cell types of the solid cells of 3D models; 2D models have 2D cells (#175)
CELLS_3D = ("tetra", "tetra10", "hexahedron", "hexahedron20", "hexahedron27")


def analysis_of(commands):
    """Return the type of the analysis of a command list (#175): ``"3d"`` (the
    default), ``"plane-strain"`` or ``"axisymmetric"``.

    Examples
    --------
    >>> analysis_of([{"command": "model.settings", "analysis": "axisymmetric"}])
    'axisymmetric'
    >>> analysis_of([])
    '3d'
    """
    settings = [c for c in commands if c["command"] == "model.settings"]
    return settings[0].get("analysis", "3d") if settings else "3d"


def planar_boundary(cmd, analysis, rotations):
    """A boundary of a rotation point constrains its rotation about z only."""
    name, constrained = cmd["name"], cmd["constrained"]
    if cmd.get("pointset") in rotations:
        others = [a for a in constrained if a != "z"]
        if not others:
            return []
        return [
            f"boundary '{name}' constrains {others[0]} of the rotation point "
            f"'{cmd['pointset']}': the rotation point of a 2D model has the rotation "
            "about z only."
        ]
    if "z" in constrained:
        return [f"boundary '{name}' constrains z, which a 2D model does not have."]
    return []


def planar_load(cmd, analysis, rotations):
    """A point load at a rotation point is a moment about z only."""
    name, force = cmd["name"], cmd["force"]
    if cmd.get("points") in rotations:
        if force[0] == 0 and force[1] == 0:
            return []
        return [
            f"point load '{name}' at the rotation point '{cmd['points']}' has a "
            "component in x or y: the rotation point of a 2D model has the moment "
            "about z only."
        ]
    if force[2] != 0:
        return [
            f"point load '{name}' has a force in z, which a 2D model does not have."
        ]
    return []


def planar_point(cmd, analysis, rotations):
    if cmd["coordinates"][2] == 0:
        return []
    return [
        f"control point '{cmd['name']}' has a z coordinate: the points of a 2D model "
        "are in the plane z = 0."
    ]


def planar_rigid(cmd, analysis, rotations):
    """The planes of rigid surfaces are lines, the cylinders circles about z."""
    name, shape = cmd["name"], cmd["shape"]
    if cmd["coordinates"][2] != 0:
        return [
            f"rigid surface '{name}' has a z coordinate: the points of a 2D model are "
            "in the plane z = 0."
        ]
    if "normal" in shape and shape["normal"][2] != 0:
        return [
            f"rigid surface '{name}' has a normal with a z component: the planes of a "
            "2D model are lines in the xy-plane."
        ]
    if "axis" in shape and (shape["axis"][0] != 0 or shape["axis"][1] != 0):
        return [
            f"rigid surface '{name}' has an axis that is not z: the cylinders of a 2D "
            "model are circles in the xy-plane."
        ]
    return []


def planar_constraint(cmd, analysis, rotations):
    """A constraint connects x and y, with a rotation point not axisymmetric."""
    name = cmd["name"]
    if "z" in cmd["constrained"]:
        return [f"constraint '{name}' connects z, which a 2D model does not have."]
    if "rotation" in cmd and analysis == "axisymmetric":
        return [
            f"constraint '{name}' has a rotation point: a rotation about z is no "
            "motion of an axisymmetric model."
        ]
    return []


def planar_cartesian(cmd, analysis, rotations):
    """The directions of a Cartesian constraint are in the xy-plane: e1 without a z
    component, and e2 is e1 turned by 90° about z (#421)."""
    name = cmd["name"]
    if cmd["e1"][2] != 0:
        return [
            f"Cartesian constraint '{name}' has e1 with a z component: the directions "
            "of a 2D model are in the xy-plane."
        ]
    if "e2" in cmd:
        return [
            f"Cartesian constraint '{name}' has e2: in a 2D model, e2 is e1 turned by "
            "90° about z."
        ]
    if "3" in cmd["constrained"]:
        return [
            f"Cartesian constraint '{name}' constrains direction 3, which a 2D model "
            "does not have."
        ]
    return []


def planar_symmetry(cmd, analysis, rotations):
    if "z" not in cmd["axes"]:
        return []
    return [
        f"symmetry '{cmd['name']}' has a plane normal to z, which a 2D model does not "
        "have."
    ]


def planar_loadcase(cmd, analysis, rotations):
    keys = [k for k in ("axis", "second", "normal") if cmd.get(k) == "z"]
    if not keys:
        return []
    return [
        f"load case '{cmd['name']}' has the axis z in '{keys[0]}', which a 2D model "
        "does not have."
    ]


def planar_faceset(cmd, analysis, rotations):
    name, select = cmd["name"], cmd["select"]
    if select.get("axis") == "z":
        return [f"face set '{name}' selects by z, which a 2D model does not have."]
    if any(c[2] != 0 for c in select.get("centers", [])):
        return [
            f"face set '{name}' has centers with a z coordinate: the edges of a 2D "
            "model are in the plane z = 0."
        ]
    return []


def planar_pointset(cmd, analysis, rotations):
    name, select = cmd["name"], cmd["select"]
    if ("value" in select or "bound" in select) and select["axis"] == "z":
        return [f"point set '{name}' selects by z, which a 2D model does not have."]
    if "radius" in select and select["axis"] != "z":
        return [
            f"point set '{name}' selects by a radius about {select['axis']}: in a 2D "
            "model, a radius is about z (a circle in the xy-plane)."
        ]
    if "points" in select and any(p[2] != 0 for p in select["points"]):
        return [
            f"point set '{name}' has points with a z coordinate: the points of a 2D "
            "model are in the plane z = 0."
        ]
    return []


# the rules of a 2D model by command type
PLANAR = {
    "boundary.add": planar_boundary,
    "load.add": planar_load,
    "point.add": planar_point,
    "rigid.add": planar_rigid,
    "mpc.add": planar_constraint,
    "cartesian.add": planar_cartesian,
    "symmetry.add": planar_symmetry,
    "loadcase.add": planar_loadcase,
    "faceset.add": planar_faceset,
    "pointset.add": planar_pointset,
}


def analysis_problems(cmd, analysis, rotations=()):
    """Return the problems of a command in a model of a type of analysis (#175): a
    2D model (plane strain or axisymmetric) has 2D cells and no z components, except
    the rotation about z of the ``rotations`` (the rotation points of constraints).

    Examples
    --------
    >>> analysis_problems(
    ...     {"command": "boundary.add", "name": "fixed", "constrained": ["x", "z"]},
    ...     "axisymmetric",
    ... )
    ["boundary 'fixed' constrains z, which a 2D model does not have."]
    """
    name = cmd["name"]
    meshes = ("mesh.import", "mesh.script")
    cell_type = cmd.get("cell_type") if cmd["command"] in meshes else None
    if analysis == "3d":
        if cell_type and cell_type not in CELLS_3D:
            return [
                f"mesh '{name}' takes {cell_type} cells, which are 2D cells: set the "
                "analysis of the settings to plane strain or axisymmetric."
            ]
        return []
    if cell_type in CELLS_3D:
        return [f"mesh '{name}' takes {cell_type} cells, but a 2D model has 2D cells."]
    rule = PLANAR.get(cmd["command"])
    return [] if rule is None else rule(cmd, analysis, rotations)
