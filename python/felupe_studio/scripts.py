"""The Python scripts of a project, run by the worker or a server before a job: of a
mesh (#182, ADR 0009) or of a material (ADR 0025).

:func:`error_of` is the error of a script with its traceback, for the issue of its
object. :func:`inspect_material` runs the script of a material once and says what it
made, so its error is an issue of the material before a job (#423). Of a strain
energy function of a file (#424), it also says the functions of the file with their
arguments, the fields of the material in the app, and evaluates the material at a
deformation.
"""

import functools
import inspect
import traceback
from pathlib import Path

from .materials import MULLINS, is_function


def error_of(error, file):
    """The error of the script ``file`` as a dict: the ``error``, its type and its
    message, and the ``traceback`` with the frames of the script only, not those of
    FElupe Studio (none without a frame of the script)."""
    trace = traceback.TracebackException.from_exception(error)
    name = Path(file).name
    frames = [f for f in trace.stack if Path(f.filename).name == name]
    message = {"error": f"{type(error).__name__}: {error}"}
    # an error without a frame of the script, e.g. of a function that it does not
    # have (#424), is its message only
    if not frames:
        return message
    trace.stack = traceback.StackSummary.from_list(frames)
    return {**message, "traceback": "".join(trace.format())}


def describe(umat):
    """The type of a constitutive model, e.g. ``NeoHooke``: of a combination its
    parts (``Hyperelastic(neo_hooke) & Volumetric``), of ``fem.Hyperelastic`` and
    ``fem.MaterialStrain`` their function.

    Examples
    --------
    >>> import felupe as fem
    >>> describe(fem.NeoHooke(mu=1.0))
    'NeoHooke'
    >>> describe(fem.Hyperelastic(fem.neo_hooke, mu=1.0) & fem.Volumetric(bulk=5.0))
    'Hyperelastic(neo_hooke) & Volumetric'
    >>> describe(fem.MaterialStrain(fem.linear_elastic, λ=2.0, μ=1.0))
    'MaterialStrain(linear_elastic)'
    """
    import felupe as fem

    if isinstance(umat, fem.CompositeMaterial):
        return " & ".join(describe(m) for m in umat.materials)
    name = type(umat).__name__
    if isinstance(umat, fem.Hyperelastic):
        function = umat.fun
    elif isinstance(umat, fem.MaterialStrain):
        function = umat.material
    else:
        return name
    function = name_of(function)
    return f"{name}({function})" if function else name


def name_of(function):
    """The name of a function of a material, e.g. ``ogden_roxburgh(neo_hooke)`` of
    the Mullins effect of a function (#346), also of a function with state variables,
    which ``fem.Hyperelastic`` wraps; None of a function without a name.

    Examples
    --------
    >>> import felupe as fem
    >>> name_of(functools.partial(fem.ogden_roxburgh, material=fem.neo_hooke))
    'ogden_roxburgh(neo_hooke)'
    """
    function = inspect.unwrap(function)
    if isinstance(function, functools.partial):
        outer = name_of(function.func)
        inner = function.keywords.get("material")
        return f"{outer}({name_of(inner)})" if inner is not None else outer
    return getattr(function, "__name__", None)


def statevars_of(umat):
    """The number of the state variables of a material, of the last array of
    ``umat.x`` like ``fem.SolidBody``; none of a material without ``x``."""
    import numpy as np

    x = getattr(umat, "x", None)
    return 0 if x is None else int(np.prod(np.shape(x[-1])))


def inspect_material(file, parameters, material=None):
    """Run the script of a material (ADR 0025) once and summarize what it made: the
    ``type`` of its material (:func:`describe`) and the number of its state variables
    (``statevars``, :func:`statevars_of`). An error of the script is the ``error`` of
    the summary, with its ``traceback`` (:func:`error_of`).

    The script of a constitutive model runs with the parameters as variables, like
    ``run_material_script()`` of the generated script. A strain energy function of a
    file (#424) is inspected by :func:`inspect_function`, with the values of the
    ``material`` command (numbers, not expressions)."""
    if material is not None and is_function(material):
        return inspect_function(file, material)
    from ._helpers import run_material_script

    result = {"file": Path(file).name}
    try:
        umat = run_material_script(file, parameters)
        statevars = statevars_of(umat)
    except (Exception, SystemExit) as error:
        return {**result, **error_of(error, file)}
    return {**result, "type": describe(umat), "statevars": statevars}


def signature_of(function):
    """The arguments of a strain energy function after ``C`` (and ``statevars``),
    each with its ``name`` and its ``default`` if it has one (None if it is no
    number), and whether the function takes state variables (``statevars``, its
    second argument) or any keyword argument (``kwargs``).

    Examples
    --------
    >>> def strain_energy(C, mu, k=0.5):
    ...     pass
    >>> signature_of(strain_energy)
    {'arguments': [{'name': 'mu'}, {'name': 'k', 'default': 0.5}], 'statevars': False}
    """
    parameters = list(inspect.signature(function).parameters.values())[1:]
    statevars = bool(parameters) and parameters[0].name == "statevars"
    arguments, kwargs = [], False
    for p in parameters[statevars:]:
        if p.kind == p.VAR_KEYWORD:
            kwargs = True
        if p.kind not in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY):
            continue
        argument = {"name": p.name}
        if p.default is not p.empty:
            number = isinstance(p.default, int | float) and type(p.default) is not bool
            argument["default"] = p.default if number else None
        arguments.append(argument)
    return {"arguments": arguments, "statevars": statevars} | (
        {"kwargs": True} if kwargs else {}
    )


def functions_of(file):
    """The functions defined in a Python file with their signatures
    (:func:`signature_of`), by their names, in their order."""
    import runpy

    namespace = runpy.run_path(str(file))
    return {
        name: signature_of(value)
        for name, value in namespace.items()
        if inspect.isfunction(value) and value.__module__ == "<run_path>"
    }


def _listed(names):
    """Names in quotes as a list in words: 'a', 'a' and 'b', 'a', 'b' and 'c'."""
    quoted = [f"'{n}'" for n in names]
    return (
        quoted[0] if len(quoted) == 1 else f"{', '.join(quoted[:-1])} and {quoted[-1]}"
    )


def function_problems(file, material, signature):
    """What does not fit the signature of the function of a material (#424), as one
    message: the arguments without a default value and without a value, the values
    of arguments that the function does not have, and its state variables.

    Examples
    --------
    >>> signature = {"arguments": [{"name": "mu"}], "statevars": False}
    >>> function_problems("soft.py", {"arguments": {"k": 1.0}}, signature)
    "The function strain_energy of 'soft.py' needs a value of its argument 'mu'. It \
has no argument 'k'."
    """
    given = material.get("arguments", {})
    names = [a["name"] for a in signature["arguments"]]
    problems = []
    missing = [
        a["name"]
        for a in signature["arguments"]
        if "default" not in a and a["name"] not in given
    ]
    if missing:
        s = "s" if len(missing) > 1 else ""
        problems.append(f"needs a value of its argument{s} {_listed(missing)}.")
    unknown = [key for key in given if key not in names]
    if unknown and not signature.get("kwargs"):
        s = "s" if len(unknown) > 1 else ""
        problems.append(f"has no argument{s} {_listed(unknown)}.")
    if signature["statevars"] and "mullins" in material:
        problems.append(
            "takes state variables, which the Mullins effect does not pass to it. "
            "Remove the Mullins effect."
        )
    elif signature["statevars"] and "nstatevars" not in material:
        problems.append("takes state variables: set their number, nstatevars.")
    elif not signature["statevars"] and "nstatevars" in material:
        problems.append(
            "takes no state variables (its second argument is not statevars). "
            "Remove nstatevars."
        )
    if not problems:
        return None
    what = f"The function {material.get('function', 'strain_energy')} of '{file}'"
    return " ".join([f"{what} {problems[0]}", *(f"It {p}" for p in problems[1:])])


def hyperelastic(file, material):
    """The material of a strain energy function of a file (#424) with the values of
    its command, like the lines of :func:`felupe_studio.materials.script_call` in the
    generated script: ``fem.Hyperelastic`` of the function, of
    ``fem.ogden_roxburgh`` with the Mullins effect, and ``fem.Volumetric`` of its
    bulk modulus."""
    import felupe as fem

    from ._helpers import material_function

    function = material_function(file, material.get("function", "strain_energy"))
    arguments = dict(material.get("arguments", {}))
    nstatevars = material.get("nstatevars", 0)
    if "mullins" in material:
        function = functools.partial(fem.ogden_roxburgh, material=function)
        arguments = {**{k: material["mullins"][k] for k in MULLINS}, **arguments}
        nstatevars = 1
    umat = fem.Hyperelastic(function, nstatevars=nstatevars, **arguments)
    if "bulk" in material:
        umat &= fem.Volumetric(bulk=material["bulk"])
    return umat


# a deformation gradient of a small deformation without symmetry, at which an
# inspection evaluates the material of a strain energy function (#424)
DEFORMATION = ((1.1, 0.05, 0.0), (0.0, 0.95, 0.02), (0.01, 0.0, 1.0))


def evaluate(umat):
    """Evaluate the stress and the elasticity tensor of a material at one point of
    one cell, at :data:`DEFORMATION` and with its state variables zero."""
    import numpy as np

    F = np.array(DEFORMATION)[..., None, None]
    x = [F, np.zeros((*np.shape(umat.x[-1]), 1, 1))]
    umat.gradient(x)
    umat.hessian(x)


def inspect_function(file, material):
    """Inspect the strain energy function of a file of a material (#424): the
    ``functions`` of the file with their signatures (:func:`functions_of`), the fields
    of the material in the app. If the material fits the signature of its function
    (:func:`function_problems`), its material is made (:func:`hyperelastic`) and
    evaluated at a deformation (:func:`evaluate`), with the ``type`` and the
    ``statevars`` of :func:`inspect_material`; else the ``error`` says why. An error
    of the file is the ``error`` with its ``traceback``."""
    result = {"file": Path(file).name}
    try:
        functions = functions_of(file)
    except (Exception, SystemExit) as error:
        return {**result, **error_of(error, file)}
    result["functions"] = functions
    signature = functions.get(material.get("function", "strain_energy"))
    problem = signature and function_problems(result["file"], material, signature)
    if problem:
        return {**result, "error": problem}
    try:
        umat = hyperelastic(file, material)
        evaluate(umat)
    except (Exception, SystemExit) as error:
        return {**result, **error_of(error, file)}
    return {**result, "type": describe(umat), "statevars": statevars_of(umat)}
