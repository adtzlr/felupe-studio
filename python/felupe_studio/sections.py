"""The parts of the script of the meshes, the materials and the sections (ADR 0018).

The meshes and their cell sets, the materials, and per section a region and a field
container, merged into the top-level field with the control points, and the solid
bodies of the sections after the merge (see :func:`felupe.field.merge`).
"""

from textwrap import wrap as wrap_text

from . import meshtools
from .formatting import (
    LINE_LENGTH,
    Call,
    Dict,
    List,
    call,
    number,
    quote,
    vector,
    wrap,
)
from .formulations import formulation_of
from .materials import lame_call, material_call


def script_parameters(script, parameters=None):
    """Return the dict of the parameters that a script of a mesh (#182) or of a
    material (ADR 0025) gets as variables: the listed ones, or all parameters of the
    model, each as its variable of the generated script."""
    names = script.get("parameters", parameters or [])
    return Dict(f"{quote(n)}: {n}" for n in names)


def script_args(mesh, parameters=None):
    """Return the arguments of ``run_mesh_script()`` of a ``mesh.script`` command
    (#182): the file, a dict of its parameters (the listed ones, or all parameters
    of the model) and the item, tag and cell type if they are given.

    Examples
    --------
    >>> [str(a) for a in script_args(
    ...     {"name": "rubber", "file": "spring.py", "item": "rubber"}, ["radius"]
    ... )]
    ['"spring.py"', '{"radius": radius}', 'item="rubber"']
    """
    args = [quote(mesh["file"]), script_parameters(mesh, parameters)]
    for key in ("item", "tag", "cell_type"):
        if key in mesh:
            args.append(f"{key}={quote(mesh[key])}")
    return args


def mesh_script(context, mesh):
    """A mesh made by a script with the parameters of the model (#182)."""
    args = script_args(mesh, [p["name"] for p in context.parameters])
    if context.dim == 2:
        args.append("dim=2")
    return [call(mesh["name"], "run_mesh_script", args)]


def mesh_import(context, mesh):
    """The volume cells of an imported mesh."""
    args = [f"meshio.read({quote(mesh['file'])})"]
    for key in ("tag", "cell_type"):
        if key in mesh:
            args.append(f"{key}={quote(mesh[key])}")
    # the factor of the coordinates, e.g. from m to mm (#135)
    if mesh.get("scale", 1) != 1:
        args.append(f"scale={mesh['scale']!r}")
    # the 2D cells of a 2D model (#175)
    if context.dim == 2:
        args.append("dim=2")
    return [call(mesh["name"], "volume_cells", args)]


def mesh_generate(context, mesh):
    """A mesh made by a tool of FElupe (ADR 0019), one line per step, and the cell
    tags of the meshes it takes, if they have them (#438)."""
    function, args, end = meshtools.call(mesh, context.dimensions)
    lines = [call(mesh["name"], function, args, end)]
    if mesh["name"] in context.tag_names:
        lines.append(call(*meshtools.tags_call(mesh)))
    return lines


def cellset(context, command):
    """A cell set of a mesh: its cells of a tag, or all of them."""
    m = command["mesh"]
    cells = f"{m}.cells"
    if command["command"] == "cellset.from_tag":
        cells += f"[{m}.tags == {command['value']!r}]"
    return [call(command["name"], "fem.Mesh", [f"{m}.points", cells, f"{m}.cell_type"])]


def material(context, mat):
    """A material, and its Lamé constants or its volumetric part if it has them."""
    func, args, volumetric = material_call(mat)
    lines = []
    # the Lamé constants of a strain-based material (#191), as names that no object
    # can have (a name has ASCII letters only)
    lame = lame_call(mat)
    if lame is not None:
        lines.append(call("λ, μ", "fem.constitution.lame_converter", lame))
    lines.append(call(mat["name"], func, args))
    if volumetric:
        lines.append(wrap(f"{mat['name']} &= fem.Volumetric", volumetric))
    return lines


def material_script(context, mat):
    """A user-defined material of a Python file (ADR 0025): its variable ``umat``,
    made with the parameters of the model.

    Examples
    --------
    >>> from types import SimpleNamespace
    >>> context = SimpleNamespace(parameters=[{"name": "mu"}])
    >>> material_script(
    ...     context, {"name": "soft", "file": "soft.py", "kind": "constitutive"}
    ... )
    ['soft = run_material_script("soft.py", {"mu": mu})']
    """
    names = [p["name"] for p in context.parameters]
    args = [quote(mat["file"]), script_parameters(mat, names)]
    return [call(mat["name"], "run_material_script", args)]


def displacement_fields(context, cellset, region, field):
    """The region of a cell set and the field container of its displacements."""
    return [
        call(region, f"REGIONS[{cellset}.cell_type]", [cellset], context.astype),
        context.container(field, region),
    ]


def condensed_fields(context, cellset, region, field):
    """The region of the hexahedrons or quads of a cell set and the field container of
    its displacements, whose solid body condenses the pressure and the volume ratio
    of every cell (u-p-J-condensed, #420): ``condensed_region`` raises for other
    cells."""
    return [
        call(region, "condensed_region", [cellset], context.astype),
        context.container(field, region),
    ]


def mixed_fields(context, cellset, region, field):
    """The region and the field container of the mixed fields of the displacements,
    the pressure and the volume ratio, of every cell type (#420): linear tetrahedra
    and triangles with a bubble point (MINI)."""
    flag = [context.mixed_flag] if context.mixed_flag else []
    return [
        call(region, "mixed_region", [cellset], context.astype),
        call(field, "fem.FieldsMixed", [region, "n=3", *flag, *context.dtype]),
    ]


def automatic_fields(context, cellset, region, field):
    """The region and the field container of the mixed fields of the displacements,
    the pressure and the volume ratio: the displacements only of linear hexahedrons
    and quads, whose pressure and volume ratio are condensed per cell (#226)."""
    flag = [context.mixed_flag] if context.mixed_flag else []
    return [
        call(region, "mixed_region", [cellset], context.astype),
        call(field, "mixed_field", [region, *flag, *context.dtype]),
    ]


def comment(text):
    """A comment of the script, wrapped at the line length.

    Examples
    --------
    >>> comment("rubber: the pressure and the volume ratio as mixed fields")
    '# rubber: the pressure and the volume ratio as mixed fields'
    """
    return "\n".join(f"# {line}" for line in wrap_text(text, LINE_LENGTH - 2))


def bulk(sec):
    """The bulk modulus of a nearly incompressible section and the volumetric part of
    the strain energy if not the default (#134)."""
    args = [f"bulk={sec['bulk']!r}"]
    volumetric = sec.get("volumetric", "volume-ratio")
    if volumetric != "volume-ratio":
        args.append(f"volumetric={quote(volumetric)}")
    return args


def solid(sec, target, field):
    """``fem.SolidBody`` of the material."""
    return [call(target, "fem.SolidBody", [sec["material"], field])]


def nearly_incompressible(sec, target, field):
    """``nearly_incompressible()``: fem.SolidBodyNearlyIncompressible of linear
    hexahedrons and quads, else fem.NearlyIncompressible on the mixed fields (#226),
    with the bulk modulus of the section."""
    return [call(target, "nearly_incompressible", [sec["material"], field, *bulk(sec)])]


def condensed(sec, target, field):
    """``fem.SolidBodyNearlyIncompressible``, which condenses the pressure and the
    volume ratio of every cell (#420), with the bulk modulus of the section."""
    return [
        comment(f"{sec['name']}: the pressure and the volume ratio condensed per cell"),
        call(
            target,
            "fem.SolidBodyNearlyIncompressible",
            [sec["material"], field, *bulk(sec)],
        ),
    ]


def mixed(sec, target, field):
    """``fem.SolidBody`` of ``fem.NearlyIncompressible`` on the mixed fields (#420),
    with the bulk modulus of the section."""
    umat = Call("fem.NearlyIncompressible", [sec["material"], *bulk(sec)])
    return [
        comment(f"{sec['name']}: the pressure and the volume ratio as mixed fields"),
        call(target, "fem.SolidBody", [umat, field]),
    ]


def three_field(sec, target, field):
    """``fem.SolidBody`` of ``fem.ThreeFieldVariation`` on the mixed fields (#420),
    with the volumetric part of the material."""
    umat = Call("fem.ThreeFieldVariation", [sec["material"]])
    return [
        comment(
            f"{sec['name']}: the three-field variation with the volumetric part of the "
            "material"
        ),
        call(target, "fem.SolidBody", [umat, field]),
    ]


# the builders of the fields and of the solid body of a section, by the fields and
# the body of its formulation (x-felupe of the formulation registry, ADR 0024)
FIELDS = {
    "u": displacement_fields,
    "condensed": condensed_fields,
    "mixed": mixed_fields,
    "automatic": automatic_fields,
}
BODIES = {
    "fem.SolidBody": solid,
    "fem.SolidBodyNearlyIncompressible": condensed,
    "fem.NearlyIncompressible": mixed,
    "fem.ThreeFieldVariation": three_field,
    "nearly_incompressible": nearly_incompressible,
}

# the blocks of the helpers of the script that the builders of the fields and of the
# solid bodies need, by the fields and the body of a formulation (embedded by codegen)
FIELD_HELPERS = {
    "condensed": ("condensed",),
    "mixed": ("mixed",),
    "automatic": ("mixed", "automatic"),
}
BODY_HELPERS = {"nearly_incompressible": ("automatic",)}


def helpers(sections):
    """The blocks of the helpers that the fields and the solid bodies of sections
    need, e.g. ``mixed_region`` of mixed fields (``mixed``).

    Examples
    --------
    >>> sorted(helpers([{"formulation": "u-p-J"}, {"formulation": "u"}]))
    ['automatic', 'mixed']
    """
    needed = set()
    for formulation in map(formulation_of, sections):
        needed.update(FIELD_HELPERS.get(formulation.fields, ()))
        needed.update(BODY_HELPERS.get(formulation.body, ()))
    return needed


def section_fields(context, sec):
    """The region and the field container of a section."""
    builder = FIELDS[formulation_of(sec).fields]
    name = sec["name"]
    return builder(context, sec["cellset"], f"region_{name}", f"field_{name}")


def solid_body(context, sec):
    """The solid body of a section."""
    name = sec["name"]
    return BODIES[formulation_of(sec).body](sec, f"solid_{name}", f"field_{name}")


def rigid_comment(rigid, dim=3):
    """The comment of a rigid surface in the script (#219): its shape and its
    reference point.

    Examples
    --------
    >>> plate = {"name": "plate", "coordinates": [0, 0, 10]}
    >>> rigid_comment({**plate, "shape": {"normal": [0, 0, -1]}})
    'plate: a rigid plane through [0, 0, 10], its normal [0, 0, -1]'
    >>> rigid_comment(
    ...     {"name": "roller", "coordinates": [0, 0, 0], "shape": {"radius": 5,
    ...      "axis": [0, 0, 1]}},
    ...     dim=2,
    ... )
    'roller: a rigid circle of radius 5 about [0, 0]'
    """

    def numbers(values):
        return f"[{', '.join(number(v) for v in values)}]"

    shape, point = rigid["shape"], numbers(rigid["coordinates"][:dim])
    if "normal" in shape:
        kind = "plane" if dim == 3 else "line"
        normal = numbers(shape["normal"][:dim])
        return f"{rigid['name']}: a rigid {kind} through {point}, its normal {normal}"
    inside = ", the points inside" if shape.get("inside") else ""
    radius = number(shape["radius"])
    if dim == 2:
        return (
            f"{rigid['name']}: a rigid circle of radius {radius} about {point}{inside}"
        )
    axis = numbers(shape["axis"])
    return (
        f"{rigid['name']}: a rigid cylinder of radius {radius} about {point}, its axis "
        f"{axis}{inside}"
    )


def control_points(context):
    """The control points and the reference points of the rigid surfaces: a region of
    vertices with a field container, not nodes of the sections."""
    if not context.controls:
        return []
    if context.rigids:
        lines = [
            "\n# control points and reference points of rigid surfaces (#219): a mesh "
            "of\n# vertices, not nodes of the sections"
        ]
    else:
        lines = ["\n# control points: a mesh of vertices, not nodes of the sections"]
    lines += [f"# {rigid_comment(r, context.dim)}" for r in context.rigids.values()]
    # in the xy-plane of a 2D model (#175)
    coordinates = List(
        vector(p["coordinates"][: context.dim]) for p in context.controls
    )
    region = "region_control_points"
    lines.append(call(region, "vertex_region", [coordinates], context.astype))
    lines.append(context.container("field_control_points", region))
    return lines


def merge(context):
    """The merge of the fields of all sections and of the control points."""
    fields = [f"field_{s['name']}" for s in context.sections]
    if context.controls:
        fields.append("field_control_points")
    decimals = [f"decimals={m['decimals']!r}" for m in context.get("mesh.merge")]
    return [
        "\n# merge the displacements of all sections into the top-level field",
        call("field", "fem.field.merge", [List(fields), *decimals]),
    ]


MESHES = {
    "mesh.import": mesh_import,
    "mesh.script": mesh_script,
    "mesh.generate": mesh_generate,
}
CELLSETS = {"cellset.from_tag": cellset, "cellset.from_file": cellset}
MATERIALS = {"material.add": material, "material.script": material_script}
SECTIONS = {"section.add": section_fields}
SOLIDS = {"section.add": solid_body}


def meshes(context):
    """The part of the meshes and their cell sets."""
    return context.emit(MESHES, "# meshes") + context.emit(CELLSETS, "# cell sets")


def materials(context):
    """The part of the materials."""
    return context.emit(MATERIALS, "# materials")


def sections(context):
    """The part of the sections: a region and a field container per section, the
    control points, the merge of their fields into the top-level field and the solid
    bodies after the merge."""
    if not context.sections:
        return []
    return [
        *context.emit(
            SECTIONS, "# sections: a region and a field container per section"
        ),
        *control_points(context),
        *merge(context),
        *context.emit(SOLIDS, "# solid bodies"),
    ]
