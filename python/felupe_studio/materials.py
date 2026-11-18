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

A strain-based model (#191, ``x-felupe``: a ``strain`` function like
``fem.linear_elastic`` and its ``statevars``) is a ``fem.MaterialStrain`` in a
``framework`` (small strain, Total Lagrange, co-rotational or Seth-Hill with a
``strain_exponent``, FElupe 12.1). Its parameters marked
``"x-felupe": "lame"`` (Young's modulus and Poisson's ratio) are converted into the
Lamé constants λ and μ of the function; ``x-argument`` is the name of a parameter of
the function, e.g. ``σy``. A strain-based material needs the displacement
formulation ``u``.
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
    lame: bool = False
    # the name of the argument of the function of a strain-based model (#191)
    argument: str | None = None


@dataclass(frozen=True)
class Model:
    name: str
    label: str
    description: str
    call: str
    hyperelastic: bool
    parameters: tuple[Parameter, ...]
    same_length: tuple[str, ...] = ()
    # strain-based (#191): fem.MaterialStrain of the function `call`, the shapes of
    # its state variables (Python), e.g. "(1, (3, 3))"
    strain: bool = False
    statevars: str | None = None

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
            call=felupe.get("class") or felupe.get("function") or felupe["strain"],
            hyperelastic="function" in felupe,
            strain="strain" in felupe,
            statevars=felupe.get("statevars"),
            parameters=tuple(
                Parameter(
                    key=key,
                    label=p["x-label"],
                    description=p["description"],
                    required=key in parameters.get("required", []),
                    default=p.get("default"),
                    volumetric=p.get("x-felupe") == "volumetric",
                    lame=p.get("x-felupe") == "lame",
                    argument=p.get("x-argument"),
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
    without a volumetric parameter). A strain-based material takes the Lamé
    constants ``λ`` and ``μ`` of :func:`lame_call`.

    Examples
    --------
    >>> material_call({"model": "NeoHooke", "parameters": {"mu": 1.0}})
    ('fem.NeoHooke', ['mu=1.0'], [])
    >>> material_call(
    ...     {"model": "MooneyRivlin", "parameters": {"C10": 0.4, "C01": 0.1, "bulk": 5}}
    ... )
    ('fem.Hyperelastic', ['fem.mooney_rivlin', 'C10=0.4', 'C01=0.1'], ['bulk=5'])
    >>> func, args, _ = material_call(
    ...     {"model": "LinearElastic", "parameters": {"E": 210000.0, "nu": 0.3}}
    ... )
    >>> func, args[1:]
    ('fem.MaterialStrain', ['framework="small-strain"', 'λ=λ', 'μ=μ'])
    """
    model = models()[material["model"]]
    values = material["parameters"]
    args, volumetric = [], []
    for p in model.parameters:
        if p.key in values and not p.lame:
            name = p.argument or p.key
            (volumetric if p.volumetric else args).append(f"{name}={values[p.key]!r}")
    if model.strain:
        framework = material.get("framework", "small-strain")
        statevars = [f"statevars={model.statevars}"] if model.statevars else []
        # the strain exponent of a Seth-Hill strain (FElupe 12.1)
        exponent = material.get("strain_exponent")
        exponent = [] if exponent is None else [f"strain_exponent={exponent!r}"]
        options = [*statevars, f'framework="{framework}"', *exponent, "λ=λ", "μ=μ"]
        return "fem.MaterialStrain", [model.call, *options, *args], []
    if model.hyperelastic:
        return "fem.Hyperelastic", [model.call, *args], volumetric
    return model.call, args, volumetric


def lame_call(material):
    """Return the arguments of ``fem.constitution.lame_converter`` of a strain-based
    material (#191), whose result are the Lamé constants ``λ, μ`` of
    :func:`material_call`, or None for other materials.

    Examples
    --------
    >>> lame_call({"model": "LinearElastic", "parameters": {"E": 210000, "nu": 0.3}})
    ['E=210000', 'nu=0.3']
    >>> lame_call({"model": "NeoHooke", "parameters": {"mu": 1.0}}) is None
    True
    """
    model = models()[material["model"]]
    if not model.strain:
        return None
    values = material["parameters"]
    return [f"{p.key}={values[p.key]!r}" for p in model.parameters if p.lame]


def strain_based(material):
    """True if a material is strain-based (#191): it needs the displacement
    formulation ``u`` of a section."""
    return models()[material["model"]].strain


def needs_bulk(material):
    """True if a material is incompressible: its model has an optional bulk modulus,
    which is not given."""
    model = models()[material["model"]]
    return model.optional_bulk and "bulk" not in material["parameters"]
