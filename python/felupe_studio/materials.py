"""The material registry: the material models of the command schema.

Every model is a definition ``Material<Model>`` of ``material.add`` in the command
schema (:mod:`felupe_studio.commands`), the single source for the app and for
Python. It carries its label (``x-label``), how FElupe creates it (``x-felupe``:
a ``class`` like ``fem.NeoHooke``, or a ``function`` of tensortrax like
``fem.mooney_rivlin`` for ``fem.Hyperelastic``) and its parameters with label,
description, bounds and default. A parameter marked ``"x-felupe": "volumetric"`` is
not passed to the model, it adds ``fem.Volumetric(bulk=...)``.

A model with an optional bulk modulus ``bulk`` is incompressible without it and
needs the ``u-p-J`` formulation of a section. Parameters that are lists of values
(the terms of Ogden) may need the same number of values (``x-same-length``).
"""

from dataclasses import dataclass
from functools import cache

from .commands import schema


@dataclass(frozen=True)
class Parameter:
    key: str
    label: str
    description: str
    required: bool
    default: float | list[float] | None
    volumetric: bool


@dataclass(frozen=True)
class Model:
    name: str
    label: str
    description: str
    call: str
    hyperelastic: bool
    parameters: tuple[Parameter, ...]
    same_length: tuple[str, ...] = ()

    @property
    def optional_bulk(self):
        """True if the model is incompressible without its (optional) bulk modulus."""
        return any(p.key == "bulk" and not p.required for p in self.parameters)


@cache
def models():
    """Return the material models of the schema by name, in the order of the schema."""
    defs = schema()["$defs"]
    result = {}
    for ref in defs["MaterialAdd"]["oneOf"]:
        definition = defs[ref["$ref"].split("/")[-1]]
        properties = definition["properties"]
        parameters = properties["parameters"]
        felupe = definition["x-felupe"]
        name = properties["model"]["const"]
        result[name] = Model(
            name=name,
            label=definition["x-label"],
            description=definition["description"],
            call=felupe.get("class") or felupe["function"],
            hyperelastic="function" in felupe,
            parameters=tuple(
                Parameter(
                    key=key,
                    label=p["x-label"],
                    description=p["description"],
                    required=key in parameters.get("required", []),
                    default=p.get("default"),
                    volumetric=p.get("x-felupe") == "volumetric",
                )
                for key, p in parameters["properties"].items()
            ),
            same_length=tuple(parameters.get("x-same-length", ())),
        )
    return result


def problems(material):
    """Return what is wrong with the parameters of a material beyond the schema: the
    lists of values that need the same number of values (``x-same-length``).

    Examples
    --------
    >>> problems({"model": "Ogden", "parameters": {"mu": [1, 0.2], "alpha": [2]}})
    ['mu and alpha need the same number of values.']
    """
    model = models()[material["model"]]
    values = material["parameters"]
    lengths = {len(values[k]) for k in model.same_length if k in values}
    if len(lengths) > 1:
        return [f"{' and '.join(model.same_length)} need the same number of values."]
    return []


def material_call(material):
    """Return how a ``material.add`` command creates its material in Python: the
    callable, its arguments and the arguments of an added ``fem.Volumetric`` (empty
    without a volumetric parameter).

    Examples
    --------
    >>> material_call({"model": "NeoHooke", "parameters": {"mu": 1.0}})
    ('fem.NeoHooke', ['mu=1.0'], [])
    >>> material_call(
    ...     {"model": "MooneyRivlin", "parameters": {"C10": 0.4, "C01": 0.1, "bulk": 5}}
    ... )
    ('fem.Hyperelastic', ['fem.mooney_rivlin', 'C10=0.4', 'C01=0.1'], ['bulk=5'])
    """
    model = models()[material["model"]]
    values = material["parameters"]
    args, volumetric = [], []
    for p in model.parameters:
        if p.key in values:
            (volumetric if p.volumetric else args).append(f"{p.key}={values[p.key]!r}")
    if model.hyperelastic:
        return "fem.Hyperelastic", [model.call, *args], volumetric
    return model.call, args, volumetric


def needs_bulk(material):
    """True if a material is incompressible: its model has an optional bulk modulus,
    which is not given."""
    model = models()[material["model"]]
    return model.optional_bulk and "bulk" not in material["parameters"]
