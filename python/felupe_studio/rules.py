"""The rules of the validation of a command list beyond its JSON schema (#310).

A rule is a function ``(model, command) -> problems`` of a command and the
:class:`Model` of the command list: the type of its analysis, the rotation points of
its constraints, and the objects of the commands before. Every command is checked by
the rules of all commands (its type of analysis, its references, and its name) and
by the rules of its command type (:data:`RULES`), in this order. The rules mirror
``app/src/core/rules.ts`` with the same names (in camel case), and both are tested with
``tests/data/validation_cases.json``, so the messages are identical.
"""

from functools import cached_property

from . import meshtools
from .analysis import analysis_of, analysis_problems
from .commands import (
    AXES,
    KIND_NAMES,
    KINDS,
    RAMPED,
    REFERENCES,
    SINGLE,
    VERTICES,
    parameter_problems,
    reserved,
    value_at,
)
from .formulations import first, formulations, sibling
from .loadcases import problems as loadcase_problems
from .materials import models, strain_based
from .materials import problems as material_problems


def count(number, word):
    """A number with its noun, in the plural if needed, e.g. `1 value`.

    Examples
    --------
    >>> count(1, "value"), count(3, "component")
    ('1 value', '3 components')
    """
    return f"{number} {word}" if number == 1 else f"{number} {word}s"


def isclose(a, b, atol):
    """Like ``np.isclose`` of the generated script (relative tolerance 1e-5)."""
    return abs(a - b) <= atol + 1e-5 * abs(b)


def selects_point(select, point):
    """Return whether a point set by a coordinate, on a cylinder or by nodes selects
    the coordinates of a point, like the script: also a control point or the
    reference point of a rigid surface, e.g. on the plane of a bonded face (#222).
    Point sets at a bound, on the surface or by ids select no such point.

    Examples
    --------
    >>> selects_point({"axis": "z", "value": 0}, [5, 5, 0])
    True
    >>> selects_point({"axis": "z", "bound": "min"}, [5, 5, 0])
    False
    """
    atol = select.get("atol", 1e-8)
    if "value" in select:
        return isclose(point[AXES.index(select["axis"])], select["value"], atol)
    if "radius" in select:
        center = select.get("center", [0, 0, 0])
        i, j = (k for k in range(3) if k != AXES.index(select["axis"]))
        distance = ((point[i] - center[i]) ** 2 + (point[j] - center[j]) ** 2) ** 0.5
        return isclose(distance, select["radius"], atol)
    if "points" in select:
        return any(
            all(isclose(a, b, atol) for a, b in zip(point, node, strict=True))
            for node in select["points"]
        )
    return False


class Model:
    """A command list and the values that the rules use: the type of its analysis
    (#175) with its axes, the rotation points of its constraints, and the objects of
    the commands before the checked one (``defined``)."""

    def __init__(self, commands, analysis="3d"):
        self.commands = commands
        self.analysis = analysis
        self.axes = AXES if analysis == "3d" else AXES[:2]
        self.rotations = {
            c["rotation"]
            for c in commands
            if c["command"] == "mpc.add" and c.get("rotation") is not None
        }
        # name -> (index, command) of the commands before, the first of a name
        self.defined = {}
        # the reserved keywords, names and prefixes of names
        self.reserved = reserved()

    @classmethod
    def of(cls, commands):
        """The model of a command list, with the analysis of its settings."""
        return cls(commands, analysis_of(commands))

    @cached_property
    def dimensions(self):
        """The dimensions of the meshes made by tools, by their names (ADR 0019)."""
        return meshtools.dimensions(self.commands)

    @cached_property
    def selects(self):
        """The selections of the point sets, by their names."""
        return {
            c["name"]: c["select"]
            for c in self.commands
            if c["command"] == "pointset.add"
        }

    def before(self, name):
        """The command of an object defined before, or None."""
        entry = self.defined.get(name)
        return None if entry is None else entry[1]

    def kind_of(self, name):
        """The kind of an object defined before, or None."""
        command = self.before(name)
        return None if command is None else KINDS[command["command"]]


def analysis(model, cmd):
    """The cells of a mesh and, in a 2D model, the z components of a command (see
    :mod:`.analysis`)."""
    return analysis_problems(cmd, model.analysis, model.rotations)


def references(model, cmd):
    """The references of a command point to objects of the right kind, created
    before."""
    problems = []
    for field, (kinds, is_list) in REFERENCES.get(cmd["command"], {}).items():
        value = value_at(cmd, field)
        if value is None:
            continue
        kinds = (kinds,) if isinstance(kinds, str) else kinds
        text = " or ".join(KIND_NAMES.get(k, k) for k in kinds)
        # a name once, also one that a list repeats, e.g. a step of a job (#331)
        for ref in dict.fromkeys(value) if is_list else [value]:
            other = model.kind_of(ref)
            if other is None:
                problems.append(
                    f"{cmd['command']} '{cmd['name']}' references unknown {text} "
                    f"'{ref}' in '{field}'."
                )
            elif other not in kinds:
                problems.append(
                    f"'{ref}' in '{field}' of '{cmd['name']}' is a "
                    f"{KIND_NAMES.get(other, other)}, not a {text}."
                )
    return problems


def single(model, cmd):
    """A command of which a model has at most one."""
    if cmd["command"] in SINGLE and any(
        c["command"] == cmd["command"] for _, c in model.defined.values()
    ):
        return [f"only one {cmd['command']} is allowed."]
    return []


def reserved_name(model, cmd):
    """A name that the generated script uses."""
    keywords, names, prefixes = model.reserved
    name = cmd["name"]
    if name in keywords or name in names or name.startswith(prefixes):
        return [f"name '{name}' is reserved for the generated script."]
    return []


def duplicate_name(model, cmd):
    """A name of an object before."""
    if cmd["name"] in model.defined:
        return [
            f"name '{cmd['name']}' is already used by "
            f"commands/{model.defined[cmd['name']][0]}."
        ]
    return []


def ramp_targets(model, cmd):
    """The ramped items of a step are boundaries, load cases, loads or pressures."""
    return [
        f"step '{cmd['name']}' ramps unknown boundary or load '{item['target']}'."
        for item in cmd.get("ramp", {}).get("items", [])
        if model.kind_of(item["target"]) not in RAMPED
    ]


def ramp_twice(model, cmd):
    """An item is ramped once by a step."""
    targets = [item["target"] for item in cmd.get("ramp", {}).get("items", [])]
    twice = sorted({t for t in targets if targets.count(t) > 1})
    return [f"step '{cmd['name']}' ramps '{ref}' twice." for ref in twice]


def ramp_values(model, cmd):
    """The ramp of a boundary with one value per constrained component (#225)."""
    problems = []
    for item in cmd.get("ramp", {}).get("items", []):
        values = [v for v in (item.get("start", 0), item["end"]) if isinstance(v, list)]
        target = model.before(item["target"])
        if not values or target is None:
            continue
        if target["command"] != "boundary.add":
            problems.append(
                f"step '{cmd['name']}' ramps '{item['target']}' with "
                f"{count(len(values[0]), 'value')}: only a boundary ramps one value "
                "per constrained component."
            )
            continue
        constrained = len(target["constrained"])
        for number in sorted({len(v) for v in values if len(v) != constrained}):
            problems.append(
                f"step '{cmd['name']}' ramps '{item['target']}' with "
                f"{count(number, 'value')}, but the boundary constrains "
                f"{count(constrained, 'component')}."
            )
    return problems


def ramp_off(model, cmd):
    """A step ramps no boundary or load case that is off in it (#393)."""
    if "boundaries" not in cmd:
        return []
    return [
        f"step '{cmd['name']}' ramps '{item['target']}', which is off in it."
        for item in cmd.get("ramp", {}).get("items", [])
        if model.kind_of(item["target"]) == "boundary"
        and item["target"] not in cmd["boundaries"]
    ]


def boundary_values(model, cmd):
    """A boundary with a value per constrained component (#225)."""
    value, constrained = cmd.get("value"), len(cmd["constrained"])
    if not isinstance(value, list) or len(value) == constrained:
        return []
    return [
        f"boundary '{cmd['name']}' has {count(len(value), 'value')}, but it "
        f"constrains {count(constrained, 'component')}."
    ]


def cellset_tag(model, cmd):
    """A cell set from tags needs a mesh imported with a tag; a mesh made by a tool
    has no cell tags (ADR 0019)."""
    mesh = model.before(cmd["mesh"])
    if mesh is not None and mesh["command"] == "mesh.generate":
        return [
            f"cell set '{cmd['name']}' uses tag values, but mesh '{mesh['name']}' is "
            "made by a tool, without cell tags."
        ]
    if mesh is None or mesh["command"] not in ("mesh.import", "mesh.script"):
        return []
    if "tag" in mesh:
        return []
    return [
        f"cell set '{cmd['name']}' uses tag values, but mesh '{mesh['name']}' was "
        "imported without a tag."
    ]


def cellset_model_mesh(model, cmd):
    """A cell set needs a mesh of the model: of a mesh made by a tool, its points and
    its cells have the dimension of the model; a lower mesh is a construction mesh
    (ADR 0019)."""
    mesh = model.before(cmd["mesh"])
    if mesh is None or mesh["command"] != "mesh.generate":
        return []
    dimension = model.dimensions.get(mesh["name"])
    dim = len(model.axes)
    if dimension is None or meshtools.model_mesh(dimension, dim):
        return []
    return [
        f"cell set '{cmd['name']}' takes mesh '{mesh['name']}' of "
        f"{dimension['cell_type']} cells ({dimension['cells']}D), but a cell set of "
        f"a {dim}D model needs {dim}D cells with {dim}D points."
    ]


def mesh_tool(model, cmd):
    """The values of a mesh tool (ADR 0019)."""
    return [f"mesh '{cmd['name']}': {p}" for p in meshtools.problems(cmd)]


def mesh_inputs(model, cmd):
    """The inputs of an operation of the mesh tools are meshes made by tools before,
    whose dimensions fit the operation (ADR 0019)."""
    problems = []
    for name in cmd.get("inputs", []):
        mesh = model.before(name)
        if mesh is not None and mesh["command"] != "mesh.generate":
            problems.append(
                f"{cmd['tool']} takes meshes made by tools; '{name}' is not."
            )
    problems.extend(meshtools.input_problems(cmd, model.dimensions))
    return [f"mesh '{cmd['name']}': {p}" for p in problems]


def material_of(model, section):
    """The material of a section, if it is defined before."""
    material = model.before(section["material"])
    if material is None or material["command"] != "material.add":
        return None
    return material


def section_material(model, cmd):
    """The material fits the formulation of the section (ADR 0024): by ``material`` of
    the formulation registry, its volumetric part. The message names a formulation
    that fits."""
    material = material_of(model, cmd)
    formulation = formulations().get(cmd["formulation"])
    if material is None or formulation is None or formulation.fits(material):
        return []
    return [f"section '{cmd['name']}' uses {misfit(formulation, material)}"]


def misfit(formulation, material):
    """Why a formulation does not take a material, and the formulations that do: of a
    material with a volumetric part of its own (``u``, the three-field variation of
    #420), the isochoric part of a strain energy (``u-p-J``, #417, #191) or without
    a volumetric part (``u-isochoric``, #241). A formulation of the same menu that
    takes the material is named too, e.g. the three-field variation of a
    nearly incompressible one (#420)."""
    name, what = formulation.name, f"{material['model']} '{material['name']}'"
    other = sibling(formulation, material)
    if formulation.material == "volumetric" and other is not None:
        # a nearly incompressible formulation, e.g. the three-field variation
        return (
            f"the {name} formulation with {what} without a bulk modulus: it takes the "
            f"volumetric part of the material. Add 'bulk' to the material, or use "
            f"'{other}' with the bulk modulus of the section."
        )
    if formulation.material == "volumetric":
        return (
            f"the displacement formulation with {what} without a bulk modulus. Add "
            f"'bulk' to the material, use '{first('isochoric')}', or "
            f"'{first('none')}' for a material without a volumetric part, e.g. air "
            "as a third medium."
        )
    if formulation.material == "none":
        return (
            f"the formulation {name} with {what}, which has a volumetric part. Use "
            f"'{first('volumetric')}'."
        )
    displacement = f"the displacement formulation '{first('volumetric')}'"
    if other is not None:
        displacement += f" or '{other}'"
    if strain_based(material):
        return (
            f"the {name} formulation with the strain-based {what}. Use {displacement}."
        )
    if models()[material["model"]].optional_bulk:
        return (
            f"the {name} formulation with {what}, which has a volumetric part (its "
            f"bulk modulus). Remove 'bulk' from the material, or use {displacement}."
        )
    return (
        f"the {name} formulation with {what}, which is compressible. Use "
        f"{displacement}, or a nearly incompressible model without a bulk modulus."
    )


def loadcase(model, cmd):
    """The axes of a load case."""
    return loadcase_problems(cmd)


def vertex_coordinates(model, cmd):
    """Control points (and reference points of rigid surfaces, #219) at the same
    coordinates are merged by the script."""
    for _, other in model.defined.values():
        if other["command"] in VERTICES and other["coordinates"] == cmd["coordinates"]:
            return [
                f"{VERTICES[cmd['command']]} '{cmd['name']}' is at the coordinates of "
                f"{VERTICES[other['command']]} '{other['name']}': the script merges "
                "them."
            ]
    return []


def contact_points(model, cmd):
    """The points of a contact are points of the sections (#220)."""
    other = model.before(cmd["points"])
    if other is None or other["command"] != "point.add":
        return []
    return [
        f"contact '{cmd['name']}' takes the control point '{other['name']}': a "
        "contact needs points of the sections."
    ]


def rigid_shape(model, cmd):
    """The normal of a plane and the axis of a cylinder of a rigid surface."""
    problems = []
    for key, label in (("normal", "a normal"), ("axis", "an axis")):
        vector = cmd["shape"].get(key)
        if vector is not None and not any(vector):
            problems.append(
                f"rigid surface '{cmd['name']}' has {label} of zero length."
            )
    return problems


def rotation_components(model, cmd):
    """A rotation point needs all components of the center point (x and y of a 2D
    model, #175)."""
    if "rotation" not in cmd or set(cmd["constrained"]) == set(model.axes):
        return []
    components = "x and y" if len(model.axes) == 2 else "x, y and z"
    return [
        f"constraint '{cmd['name']}' with a rotation point connects all components "
        f"{components}."
    ]


def material(model, cmd):
    """The parameters of a material."""
    return [f"material '{cmd['name']}': {p}" for p in material_problems(cmd)]


def parameter(model, cmd):
    """The value and the range of a parameter of the model (#180)."""
    return [f"parameter '{cmd['name']}': {p}" for p in parameter_problems(cmd)]


def fixed_components(model, vertex):
    """The components of a control point with a boundary (also of a point set that
    selects it, e.g. of a plane through it, #222) or a constraint (as the center
    point, or all of them as the rotation point)."""
    fixed = set()
    for other in model.commands:
        if other["command"] == "boundary.add":
            select = model.selects.get(other["pointset"])
            if other["pointset"] == vertex["name"] or (
                select is not None and selects_point(select, vertex["coordinates"])
            ):
                fixed.update(other["constrained"])
        elif other["command"] == "mpc.add":
            if other["center"] == vertex["name"]:
                fixed.update(other["constrained"])
            if other.get("rotation") == vertex["name"]:
                fixed.update(AXES)
    return fixed


def vertex_stiffness(model, cmd):
    """A control point has no stiffness of its own: its components need a boundary
    or a constraint; the reference point of a rigid surface needs boundaries (#219).
    Checked after all commands."""
    fixed = fixed_components(model, cmd)
    missing = [a for a in model.axes if a not in fixed]
    if not missing:
        return []
    components = missing[0]
    if len(missing) > 1:
        components = ", ".join(missing[:-1]) + " and " + missing[-1]
    if cmd["command"] == "rigid.add":
        return [
            f"rigid surface '{cmd['name']}' has no stiffness in {components}: its "
            "reference point needs a boundary of these components."
        ]
    return [
        f"control point '{cmd['name']}' has no stiffness in {components}: it needs a "
        "boundary or a multi-point constraint of these components."
    ]


# the rules of every command: before and after the rules of its type
FIRST = (analysis, references)
LAST = (single, reserved_name, duplicate_name)

# the rules of a command type, in this order
RULES = {
    "step.add": (ramp_targets, ramp_twice, ramp_values, ramp_off),
    "boundary.add": (boundary_values,),
    "mesh.generate": (mesh_tool, mesh_inputs),
    "cellset.from_tag": (cellset_tag, cellset_model_mesh),
    "cellset.from_file": (cellset_model_mesh,),
    "section.add": (section_material,),
    "loadcase.add": (loadcase,),
    "point.add": (vertex_coordinates,),
    "rigid.add": (vertex_coordinates, rigid_shape),
    "contact.add": (contact_points,),
    "mpc.add": (rotation_components,),
    "material.add": (material,),
    "parameter.add": (parameter,),
}

# the rules of a command type that are checked after all commands
AFTER = {"point.add": (vertex_stiffness,), "rigid.add": (vertex_stiffness,)}


def problems(commands):
    """Return the problems of the commands of a command list (with the values of the
    expressions of its parameters), prefixed by ``commands/<index>: ``."""
    model = Model.of(commands)
    messages = []
    for i, cmd in enumerate(commands):
        rules = (*FIRST, *RULES.get(cmd["command"], ()), *LAST)
        messages.extend(f"commands/{i}: {p}" for r in rules for p in r(model, cmd))
        model.defined.setdefault(cmd["name"], (i, cmd))
    for i, cmd in enumerate(commands):
        rules = AFTER.get(cmd["command"], ())
        messages.extend(f"commands/{i}: {p}" for r in rules for p in r(model, cmd))
    return messages
