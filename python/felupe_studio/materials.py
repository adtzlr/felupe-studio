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

A hyperelastic model with a strain energy function (Neo-Hooke and the models of
tensortrax, not the extended tube) may have the Mullins effect of Ogden and Roxburgh
(``mullins``, #346): the material is ``fem.OgdenRoxburgh`` of ``fem.NeoHooke``, or
``fem.Hyperelastic`` of ``fem.ogden_roxburgh`` with the function of the model as its
``material`` and one state variable, the maximum strain energy density of the load
history. ``functools.partial`` passes the function: ``fem.Hyperelastic`` would pass
the defaults of ``fem.ogden_roxburgh`` (``mu`` of ``fem.neo_hooke``) to every
function (adtzlr/felupe#1302). The bulk modulus is a ``fem.Volumetric`` after it,
without softening.

A strain-based model (#191, ``x-felupe``: a ``strain`` function like
``fem.linear_elastic`` and its ``statevars``) is a ``fem.MaterialStrain`` in a
``framework`` (small strain, Total Lagrange, co-rotational or Seth-Hill with a
``strain_exponent``, FElupe 12.1). Its parameters marked
``"x-felupe": "lame"`` (Young's modulus and Poisson's ratio) are converted into the
Lamé constants λ and μ of the function; ``x-argument`` is the name of a parameter of
the function, e.g. ``σy``. A strain-based material needs the displacement
formulation ``u``.

A user-defined material of a Python file (``material.script``, ADR 0025) is not a
model of the registry: a constitutive model that the file makes, or a strain energy
function of the file (#424), which is a ``fem.Hyperelastic`` like a model of
tensortrax (:func:`script_call`).
"""

from dataclasses import dataclass
from functools import cache

from .commands import schema
from .formatting import Call, Keyword, quote


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
    # the Mullins effect of Ogden and Roxburgh is an option of the model (#346)
    mullins: bool = False

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
            mullins="mullins" in properties,
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

    With the Mullins effect (#346), the bulk modulus of Neo-Hooke is not softened:

    >>> func, args, volumetric = material_call(
    ...     {"model": "NeoHooke", "parameters": {"mu": 1.0, "bulk": 50},
    ...      "mullins": {"r": 3, "m": 1, "beta": 0.1}}
    ... )
    >>> func, args
    ('fem.OgdenRoxburgh', ['fem.NeoHooke(mu=1.0)', 'r=3', 'm=1', 'beta=0.1'])
    >>> volumetric
    ['bulk=50']
    """
    model = models()[material["model"]]
    values = material["parameters"]
    mullins = material.get("mullins")
    args, volumetric = [], []
    for p in model.parameters:
        if p.key in values and not p.lame:
            name = p.argument or p.key
            # the bulk modulus of Neo-Hooke is a fem.Volumetric with the Mullins effect
            outside = p.volumetric or (mullins is not None and p.key == "bulk")
            (volumetric if outside else args).append(f"{name}={values[p.key]!r}")
    if mullins is not None:
        return (*_mullins_call(model, mullins, args), volumetric)
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


# the parameters of the Mullins effect, arguments of fem.ogden_roxburgh (#346)
MULLINS = ("r", "m", "beta")


def _mullins_call(model, mullins, args):
    """The callable and the arguments of a material with the Mullins effect (#346)."""
    softening = _softening(mullins)
    if model.hyperelastic:
        function = f"functools.partial(fem.ogden_roxburgh, material={model.call})"
        return "fem.Hyperelastic", [function, *softening, *args, "nstatevars=1"]
    return "fem.OgdenRoxburgh", [f"{model.call}({', '.join(args)})", *softening]


def _softening(mullins):
    """The arguments of the Mullins effect of ``fem.ogden_roxburgh`` (#346)."""
    return [f"{key}={mullins[key]!r}" for key in MULLINS]


def script_call(material):
    """Return how a strain energy function of a file (``material.script`` of the kind
    ``hyperelastic``, #424) creates its material, like :func:`material_call`: the
    function of the file (``material_function()``) in ``fem.Hyperelastic`` with the
    values of its arguments, and the arguments of an added ``fem.Volumetric``.

    Examples
    --------
    >>> func, args, volumetric = script_call(
    ...     {"file": "soft.py", "kind": "hyperelastic",
    ...      "arguments": {"mu": 1.0, "k": 0.1}, "bulk": 50}
    ... )
    >>> func, args[1:], volumetric
    ('fem.Hyperelastic', ['mu=1.0', 'k=0.1'], ['bulk=50'])
    >>> print(args[0])
    material_function("soft.py", "strain_energy")

    A function with state variables, and one with the Mullins effect:

    >>> [str(a) for a in script_call({"file": "soft.py", "kind": "hyperelastic",
    ...                               "function": "aged", "nstatevars": 2})[1]]
    ['material_function("soft.py", "aged")', 'nstatevars=2']
    >>> _, args, _ = script_call({"file": "soft.py", "kind": "hyperelastic",
    ...                           "mullins": {"r": 3, "m": 1, "beta": 0.1}})
    >>> print(args[0])
    functools.partial(fem.ogden_roxburgh, material=material_function("soft.py", \
"strain_energy"))
    >>> args[1:]
    ['r=3', 'm=1', 'beta=0.1', 'nstatevars=1']
    """
    name = material.get("function", "strain_energy")
    function = Call("material_function", [quote(material["file"]), quote(name)])
    args = [f"{k}={v!r}" for k, v in material.get("arguments", {}).items()]
    volumetric = [f"bulk={material['bulk']!r}"] if "bulk" in material else []
    if "mullins" in material:
        # fem.ogden_roxburgh with the function as its material, as of a model of
        # tensortrax (#346), wrapped like ruff format
        softened = Keyword("material", function)
        partial = Call("functools.partial", ["fem.ogden_roxburgh", softened])
        softening = _softening(material["mullins"])
        args = [partial, *softening, *args, "nstatevars=1"]
        return "fem.Hyperelastic", args, volumetric
    nstatevars = material.get("nstatevars")
    statevars = [f"nstatevars={nstatevars}"] if nstatevars else []
    return "fem.Hyperelastic", [function, *statevars, *args], volumetric


def uses_functools(materials):
    """True if a material of tensortrax has the Mullins effect, whose function the
    script passes with ``functools.partial`` (#346): a model of the registry, or a
    strain energy function of a file (#424)."""
    return any(
        "mullins" in m and (is_script(m) or models()[m["model"]].hyperelastic)
        for m in materials
    )


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


def is_script(material):
    """True if a material is user-defined, of a Python file (``material.script``,
    ADR 0025), not a model of the registry."""
    return material.get("command") == "material.script"


def is_function(material):
    """True if a material is a strain energy function of a file (``material.script``
    of the kind ``hyperelastic``, #424)."""
    return is_script(material) and material["kind"] == "hyperelastic"


def strain_based(material):
    """True if a material is strain-based (#191): it needs the displacement
    formulation ``u`` of a section. A constitutive model of a file is not."""
    return not is_script(material) and models()[material["model"]].strain


def needs_bulk(material):
    """True if a material is incompressible: its model has an optional bulk modulus,
    which is not given."""
    model = models()[material["model"]]
    return model.optional_bulk and "bulk" not in material["parameters"]


def has_volumetric(material):
    """True if a material has a volumetric part of its own (#417): its bulk modulus
    is given, or its model has no optional bulk modulus (a compressible or a
    strain-based model). The u-p-J formulation adds the volumetric part of the
    section, so it takes a material without one. A material of a file says so with
    ``volumetric`` (ADR 0025, by default it has one).

    Examples
    --------
    >>> has_volumetric({"command": "material.script", "name": "soft",
    ...                 "kind": "constitutive", "file": "soft.py"})
    True
    >>> has_volumetric({"command": "material.script", "name": "soft",
    ...                 "kind": "constitutive", "file": "soft.py",
    ...                 "volumetric": False})
    False

    A strain energy function of a file has one with its bulk modulus (#424):

    >>> has_volumetric({"command": "material.script", "name": "soft",
    ...                 "kind": "hyperelastic", "file": "soft.py"})
    False
    """
    if is_function(material):
        return "bulk" in material
    if is_script(material):
        return material.get("volumetric", True)
    return not needs_bulk(material)
