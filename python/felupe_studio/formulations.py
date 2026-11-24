"""The formulation registry: the formulations of the sections in the command schema
(ADR 0024).

Every formulation is a definition ``Section<Formulation>`` of ``section.add`` in the
command schema (:mod:`felupe_studio.commands`), like the material models
(:mod:`felupe_studio.materials`): its value of ``formulation``, its label
(``x-label``), the menu of the ribbon (``x-group``), the hint of the form
(``x-hint``) and how FElupe solves it (``x-felupe``):

- ``body``: the solid body, ``fem.SolidBody``, ``fem.SolidBodyNearlyIncompressible``
  (the pressure and the volume ratio condensed per cell), ``fem.NearlyIncompressible``
  or ``fem.ThreeFieldVariation`` (the material of a ``fem.SolidBody`` on mixed
  fields), or ``nearly_incompressible`` (a helper of the script that chooses one of
  the first two by its fields, #226);
- ``fields``: the region and the field container, ``u`` (the displacements),
  ``condensed`` (the displacements of hexahedrons and quads, ``condensed_region``),
  ``mixed`` (``mixed_region`` and ``fem.FieldsMixed``: the displacements, the
  pressure and the volume ratio) or ``automatic`` (``mixed_region`` and
  ``mixed_field``: the displacements only of linear hexahedrons and quads, else
  mixed fields);
- ``cells``: the cell types that it takes, or ``all``;
- ``material``: the material that it takes, ``volumetric`` (with a volumetric part
  of its own), ``isochoric`` (the isochoric part of a strain energy: the section
  adds the volumetric part) or ``none`` (without a volumetric part, and the section
  adds none, e.g. air as a third medium).

:mod:`felupe_studio.sections` builds the fields and the solid body of a section by
``fields`` and ``body``, the rules check ``material``
(:func:`felupe_studio.rules.section_material`) and :mod:`felupe_studio.checks` the
cell types. A new formulation is a definition, and a builder of its fields or its
solid body if it needs one of its own.
"""

from dataclasses import dataclass
from functools import cache

from .commands import schema
from .materials import has_volumetric, strain_based

# what the material of a formulation has (x-felupe: material)
MATERIALS = ("volumetric", "isochoric", "none")

# the fields that may have dual fields, the pressure and the volume ratio of mixed
# fields (x-felupe: fields)
DUAL = ("mixed", "automatic")

# the plural of the cell types of the formulations, for their messages
CELLS = {
    "tetra": "tetrahedrons",
    "hexahedron": "hexahedrons",
    "triangle": "triangles",
    "quad": "quads",
}


@dataclass(frozen=True)
class Formulation:
    name: str
    label: str
    group: str
    hint: str
    description: str
    body: str
    fields: str
    # the cell types, or None for all
    cells: tuple[str, ...] | None
    material: str

    def fits(self, material):
        """True if the formulation takes a material (a ``material.add`` command).

        Examples
        --------
        >>> u, upj = formulations()["u"], formulations()["u-p-J"]
        >>> rubber = {"model": "NeoHooke", "parameters": {"mu": 1.0}}
        >>> u.fits(rubber), upj.fits(rubber)
        (False, True)
        >>> steel = {"model": "LinearElastic", "parameters": {"E": 2e5, "nu": 0.3}}
        >>> u.fits(steel), upj.fits(steel)
        (True, False)
        """
        if self.material == "volumetric":
            return has_volumetric(material)
        if self.material == "isochoric":
            return not has_volumetric(material) and not strain_based(material)
        return not has_volumetric(material)

    @property
    def dual(self):
        """True if the fields may have dual fields, the pressure and the volume ratio
        of mixed fields: a step that leaves out the section holds them (#428)."""
        return self.fields in DUAL

    def takes(self, cell_type):
        """True if the formulation takes cells of a type (#420).

        Examples
        --------
        >>> condensed = formulations()["u-p-J-condensed"]
        >>> condensed.takes("hexahedron20"), condensed.takes("tetra")
        (True, False)
        >>> formulations()["u-p-J"].takes("tetra")
        True
        """
        return self.cells is None or cell_type in self.cells

    @property
    def kinds(self):
        """The kinds of cells that the formulation takes, e.g. ``hexahedrons and
        quads``, or None for all.

        Examples
        --------
        >>> formulations()["u-p-J-condensed"].kinds
        'hexahedrons and quads'
        """
        if self.cells is None:
            return None
        bases = (c.rstrip("0123456789") for c in self.cells)
        kinds = dict.fromkeys(CELLS.get(base, base) for base in bases)
        return " and ".join(kinds)


@cache
def formulations():
    """Return the formulations of the schema by name, in the order of the schema."""
    defs = schema()["$defs"]
    result = {}
    for ref in defs["SectionAdd"]["oneOf"]:
        definition = defs[ref["$ref"].split("/")[-1]]
        felupe = definition["x-felupe"]
        name = definition["properties"]["formulation"]["const"]
        cells = felupe["cells"]
        result[name] = Formulation(
            name=name,
            label=definition["x-label"],
            group=definition["x-group"],
            hint=definition["x-hint"],
            description=definition["description"],
            body=felupe["body"],
            fields=felupe["fields"],
            cells=None if cells == "all" else tuple(cells),
            material=felupe["material"],
        )
    return result


def formulation_of(section):
    """Return the formulation of a ``section.add`` command."""
    return formulations()[section["formulation"]]


def first(material):
    """Return the name of the first formulation of the registry that takes a material
    of a kind of ``MATERIALS``, e.g. ``u`` for ``volumetric``.

    Examples
    --------
    >>> first("volumetric"), first("isochoric"), first("none")
    ('u', 'u-p-J', 'u-isochoric')
    """
    return next(f.name for f in formulations().values() if f.material == material)


def sibling(formulation, material):
    """Return the name of the first other formulation of the menu of a formulation
    (``x-group``) that takes a material (a ``material.add`` command), or None, e.g.
    the three-field variation of a nearly incompressible formulation for a material
    with a volumetric part (#420).

    Examples
    --------
    >>> steel = {"model": "LinearElastic", "parameters": {"E": 2e5, "nu": 0.3}}
    >>> sibling(formulations()["u-p-J"], steel)
    'u-p-J-three-field'
    >>> print(sibling(formulations()["u"], steel))
    None
    """
    return next(
        (
            f.name
            for f in formulations().values()
            if f.group == formulation.group
            and f is not formulation
            and f.fits(material)
        ),
        None,
    )


def alternatives(formulation, cell_type):
    """Return the names of the other formulations of the menu of a formulation that
    take its material and cells of a type, e.g. ``u-p-J`` and ``u-p-J-mixed`` for
    the tetrahedrons of a section condensed per cell (#420).

    Examples
    --------
    >>> alternatives(formulations()["u-p-J-condensed"], "tetra")
    ['u-p-J', 'u-p-J-mixed']
    """
    return [
        f.name
        for f in formulations().values()
        if f.group == formulation.group
        and f.material == formulation.material
        and f.takes(cell_type)
    ]


def cell_problem(section, cell_type):
    """Return why the formulation of a section does not take its cells, or None
    (#420), and the formulations of its menu that do: the message of
    ``formulationNotes()`` of the app, e.g. *Condensed per cell (u-p-J-condensed)
    takes hexahedrons and quads, not the tetra cells of 'rubber'. Use 'u-p-J' or
    'u-p-J-mixed'.*

    Examples
    --------
    >>> section = {"name": "rubber", "formulation": "u-p-J-condensed"}
    >>> print(cell_problem(section, "quad8"))
    None
    """
    formulation = formulation_of(section)
    if formulation.takes(cell_type):
        return None
    others = alternatives(formulation, cell_type)
    use = " or ".join(f"'{name}'" for name in others)
    use = f" Use {use}." if others else ""
    return (
        f"{formulation.label} ({formulation.name}) takes {formulation.kinds}, not the "
        f"{cell_type} cells of '{section['name']}'.{use}"
    )
