"""The formulation registry: the formulations of the sections in the command schema
(ADR 0024).

Every formulation is a definition ``Section<Formulation>`` of ``section.add`` in the
command schema (:mod:`felupe_studio.commands`), like the material models
(:mod:`felupe_studio.materials`): its value of ``formulation``, its label
(``x-label``), the menu of the ribbon (``x-group``) and how FElupe solves it
(``x-felupe``):

- ``body``: the solid body, ``fem.SolidBody`` or ``nearly_incompressible`` (a helper
  of the script: ``fem.SolidBodyNearlyIncompressible`` of a field of the
  displacements only, else ``fem.NearlyIncompressible`` on the mixed fields);
- ``fields``: the region and the field container, ``u`` (the displacements) or
  ``mixed`` (``mixed_region`` and ``mixed_field``: the displacements, the pressure
  and the volume ratio, condensed per cell of linear hexahedrons and quads);
- ``cells``: the cell types that it takes, or ``all``;
- ``material``: the material that it takes, ``volumetric`` (with a volumetric part
  of its own), ``isochoric`` (the isochoric part of a strain energy: the section
  adds the volumetric part), ``none`` (without a volumetric part, and the section
  adds none, e.g. air as a third medium) or ``any``.

:mod:`felupe_studio.sections` builds the fields and the solid body of a section by
``fields`` and ``body``, and the rules check ``material``
(:func:`felupe_studio.rules.section_material`). A new formulation is a definition,
and a builder of its fields or its solid body if it needs one of its own.
"""

from dataclasses import dataclass
from functools import cache

from .commands import schema
from .materials import has_volumetric, strain_based

# what the material of a formulation has (x-felupe: material)
MATERIALS = ("volumetric", "isochoric", "none", "any")


@dataclass(frozen=True)
class Formulation:
    name: str
    label: str
    group: str
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
        if self.material == "any":
            return True
        if self.material == "volumetric":
            return has_volumetric(material)
        if self.material == "isochoric":
            return not has_volumetric(material) and not strain_based(material)
        return not has_volumetric(material)

    @property
    def dual(self):
        """True if the fields may have dual fields, the pressure and the volume ratio
        of mixed fields: a step that leaves out the section holds them (#428)."""
        return self.fields == "mixed"


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
