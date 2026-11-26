"""The Python scripts of a project, run by the worker or a server before a job: of a
mesh (#182, ADR 0009) or of a material (ADR 0025).

:func:`error_of` is the error of a script with its traceback, for the issue of its
object. :func:`inspect_material` runs the script of a material once and says what it
made, so its error is an issue of the material before a job (#423). Of a function of
a file, a strain energy function (#424) or a strain-based function (#425), it also
says the functions of the file with their arguments, the fields of the material in
the app, and evaluates the material at a deformation.
"""

import functools
import inspect
import traceback
from pathlib import Path

from .materials import MULLINS, function_name, is_function, shapes


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
    # fem.Hyperelastic is there only with tensortrax
    if isinstance(umat, getattr(fem, "Hyperelastic", ())):
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
    ``umat.x`` like ``fem.SolidBody``; none of a material without ``x``. Of
    ``fem.MaterialStrain`` those of its function (#425), without the strain and the
    stress of the last state that it keeps with them.

    Examples
    --------
    >>> import felupe as fem
    >>> statevars_of(fem.MaterialStrain(fem.linear_elastic, λ=2.0, μ=1.0))
    0
    """
    import felupe as fem
    import numpy as np

    if isinstance(umat, fem.MaterialStrain):
        return int(umat.nstatevars)
    x = getattr(umat, "x", None)
    return 0 if x is None else int(np.prod(np.shape(x[-1])))


def inspect_material(file, parameters, material=None):
    """Run the script of a material (ADR 0025) once and summarize what it made: the
    ``type`` of its material (:func:`describe`) and the number of its state variables
    (``statevars``, :func:`statevars_of`). An error of the script is the ``error`` of
    the summary, with its ``traceback`` (:func:`error_of`).

    The script of a constitutive model runs with the parameters as variables, like
    ``run_material_script()`` of the generated script. A function of a file (#424,
    #425) is inspected by :func:`inspect_function`, with the values of the
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


# the number of the arguments that the material of a function of a file gives it
# first, by its kind: C of fem.Hyperelastic (#424), and dε, εn, σn and ζn of
# fem.MaterialStrain (#425), which gives the keyword argument tangent too
GIVEN = {"hyperelastic": 1, "strain": 4}


def signature_of(function, kind="hyperelastic"):
    """The arguments of a function of a material of a file after those that its
    material gives (:data:`GIVEN`), each with its ``name`` and its ``default`` if it
    has one (None if it is no number), and whether it takes any keyword argument
    (``kwargs``). Of a strain energy function (#424), whether it takes state
    variables (``statevars``, its second argument). A strain-based function (#425)
    takes the keyword argument ``tangent`` of ``fem.MaterialStrain`` (``tangent``,
    not an argument to give), usually with ``**kwargs``: its arguments are those of
    its signature, so the value of an argument that it does not have is an issue.

    Examples
    --------
    >>> def strain_energy(C, mu, k=0.5):
    ...     pass
    >>> signature_of(strain_energy)
    {'arguments': [{'name': 'mu'}, {'name': 'k', 'default': 0.5}], 'statevars': False}
    >>> def material(dε, εn, σn, ζn, E, nu, **kwargs):
    ...     pass
    >>> signature_of(material, "strain")
    {'arguments': [{'name': 'E'}, {'name': 'nu'}], 'tangent': True}
    """
    parameters = list(inspect.signature(function).parameters.values())
    parameters = parameters[GIVEN[kind] :]
    first = parameters[0].name if parameters else None
    statevars = kind == "hyperelastic" and first == "statevars"
    arguments, flags = [], {}
    for p in parameters[statevars:]:
        if p.kind == p.VAR_KEYWORD:
            flags["tangent" if kind == "strain" else "kwargs"] = True
        if p.kind not in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY):
            continue
        if kind == "strain" and p.name == "tangent":
            flags["tangent"] = True
            continue
        argument = {"name": p.name}
        if p.default is not p.empty:
            number = isinstance(p.default, int | float) and type(p.default) is not bool
            argument["default"] = p.default if number else None
        arguments.append(argument)
    if kind == "hyperelastic":
        return {"arguments": arguments, "statevars": statevars} | flags
    return {"arguments": arguments} | flags


def functions_of(file, kind="hyperelastic"):
    """The functions defined in a Python file with their signatures
    (:func:`signature_of`) as functions of a material of the kind, by their names, in
    their order."""
    import runpy

    namespace = runpy.run_path(str(file))
    return {
        name: signature_of(value, kind)
        for name, value in namespace.items()
        if inspect.isfunction(value) and value.__module__ == "<run_path>"
    }


def _listed(names, quote=True):
    """Names as a list in words, in quotes: 'a', 'a' and 'b', 'a', 'b' and 'c'."""
    items = [f"'{n}'" if quote else n for n in names]
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


def function_problems(material, signature):
    """What does not fit the signature of the function of a material (#424, #425), as
    one message: the arguments without a default value and without a value, the
    values of arguments that the function does not have, and its state variables. A
    strain-based function takes the keyword argument ``tangent``, and the time
    increment ``dtime`` of a time-dependent one needs a value: a step gives none yet.

    Examples
    --------
    >>> signature = {"arguments": [{"name": "mu"}], "statevars": False}
    >>> function_problems({"kind": "hyperelastic", "arguments": {"k": 1.0}}, signature)
    "The function strain_energy needs a value of its argument 'mu'. It has no \
argument 'k'."
    >>> function_problems({"kind": "strain"}, {"arguments": [{"name": "dtime"}]})
    'The function material takes no keyword argument tangent, which \
fem.MaterialStrain gives: end its arguments with **kwargs. It is time-dependent: a \
step gives no time increment yet, so give its argument dtime a value.'
    """
    given = material.get("arguments", {})
    names = [a["name"] for a in signature["arguments"]]
    strain = material["kind"] == "strain"
    problems = []
    if strain and not signature.get("tangent"):
        problems.append(
            "takes no keyword argument tangent, which fem.MaterialStrain gives: end "
            "its arguments with **kwargs."
        )
    missing = [
        a["name"]
        for a in signature["arguments"]
        if "default" not in a and a["name"] not in given
    ]
    # a time-dependent strain-based function (FElupe 12.1): FElupe gives dtime to a
    # function without its value, which a step of FElupe Studio does not have
    if strain and "dtime" in missing:
        missing.remove("dtime")
        problems.append(
            "is time-dependent: a step gives no time increment yet, so give its "
            "argument dtime a value."
        )
    if missing:
        s = "s" if len(missing) > 1 else ""
        problems.append(f"needs a value of its argument{s} {_listed(missing)}.")
    unknown = [key for key in given if key not in names]
    if unknown and not signature.get("kwargs"):
        s = "s" if len(unknown) > 1 else ""
        problems.append(f"has no argument{s} {_listed(unknown)}.")
    if signature.get("statevars") and "mullins" in material:
        problems.append(
            "takes state variables, which the Mullins effect does not pass to it. "
            "Remove the Mullins effect."
        )
    elif signature.get("statevars") and "nstatevars" not in material:
        problems.append("takes state variables: set their number, nstatevars.")
    elif not signature.get("statevars") and "nstatevars" in material:
        problems.append(
            "takes no state variables (its second argument is not statevars). "
            "Remove nstatevars."
        )
    if not problems:
        return None
    # the note of the material in the app has the name of the file before it
    what = f"The function {function_name(material)}"
    return " ".join([f"{what} {problems[0]}", *(f"It {p}" for p in problems[1:])])


def hyperelastic(file, material):
    """The material of a strain energy function of a file (#424) with the values of
    its command, like the lines of :func:`felupe_studio.materials.script_call` in the
    generated script: ``fem.Hyperelastic`` of the function, of
    ``fem.ogden_roxburgh`` with the Mullins effect, and ``fem.Volumetric`` of its
    bulk modulus."""
    import felupe as fem

    from ._helpers import material_function

    function = material_function(file, function_name(material))
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


def strain(file, material, returned=None):
    """The material of a strain-based function of a file (#425) with the values of
    its command, like the line of :func:`felupe_studio.materials.script_call` in the
    generated script: ``fem.MaterialStrain`` of the function in its framework. The
    list ``returned`` gets the shapes of the state variables that the function
    returns, of the last evaluation."""
    import felupe as fem
    import numpy as np

    from ._helpers import material_function

    function = material_function(file, function_name(material))
    if returned is not None:
        original = function

        @functools.wraps(original)
        def function(*args, **kwargs):
            result = original(*args, **kwargs)
            # the shapes without the axes of the quadrature points and the cells
            returned[:] = [np.shape(z)[:-2] for z in result[2]]
            return result

    options = {"framework": material.get("framework", "small-strain")}
    if "statevars" in material:
        options["statevars"] = shapes(material["statevars"])
    if "strain_exponent" in material:
        options["strain_exponent"] = material["strain_exponent"]
    return fem.MaterialStrain(function, **options, **material.get("arguments", {}))


def _sizes(shapes):
    """The sizes of the state variables of their shapes, without those of size 0,
    e.g. of ``(0,)``, the shapes of a strain-based material without them."""
    import numpy as np

    sizes = (int(np.prod(shape)) for shape in shapes)
    return [size for size in sizes if size]


def _text(shape):
    """A shape as a tuple of Python, e.g. ``(1,)`` or ``(3, 3)``."""
    return repr(tuple(shape))


def statevars_problem(material, returned):
    """The state variables that a strain-based function returns, if they do not have
    the shapes of ``statevars`` of its material (#425), as one message with the
    ``statevars`` of the shapes that it returns.

    Examples
    --------
    >>> statevars_problem({"kind": "strain"}, [(1,), (3, 3)])
    'The function material returns state variables of the shapes (1,) and (3, 3), \
not those of statevars (0,). Set statevars to (1, (3, 3)).'
    >>> statevars_problem({"kind": "strain", "statevars": [1]}, [])
    'The function material returns no state variables, not those of statevars (1,).'
    >>> statevars_problem({"kind": "strain", "statevars": [1, [3, 3]]}, [(1,), (3, 3)])
    """
    declared = [
        (s,) if isinstance(s, int) else tuple(s) for s in material.get("statevars", [0])
    ]
    if _sizes(declared) == _sizes(returned):
        return None
    texts = [_text(shape) for shape in returned]
    if not texts:
        which = "no state variables"
    elif len(texts) == 1:
        which = f"a state variable of the shape {texts[0]}"
    else:
        which = f"state variables of the shapes {_listed(texts, quote=False)}"
    what = f"The function {function_name(material)} returns {which}"
    statevars = shapes(material.get("statevars", [0]))
    message = f"{what}, not those of statevars {statevars!r}."
    if returned and all(returned):
        values = [shape[0] if len(shape) == 1 else list(shape) for shape in returned]
        message += f" Set statevars to {shapes(values)!r}."
    return message


# a deformation gradient of a small deformation without symmetry, at which an
# inspection evaluates the material of a function of a file (#424, #425)
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
    """Inspect the function of a file of a material (#424, #425): the ``functions``
    of the file with their signatures (:func:`functions_of`), the fields of the
    material in the app. If the material fits the signature of its function
    (:func:`function_problems`), its material is made (:func:`hyperelastic`,
    :func:`strain`) and evaluated at a deformation (:func:`evaluate`), with the
    ``type`` and the ``statevars`` of :func:`inspect_material`; else the ``error``
    says why, also of the state variables that a strain-based function returns
    (:func:`statevars_problem`). An error of the file is the ``error`` with its
    ``traceback``."""
    result = {"file": Path(file).name}
    kind = material["kind"]
    try:
        functions = functions_of(file, kind)
    except (Exception, SystemExit) as error:
        return {**result, **error_of(error, file)}
    result["functions"] = functions
    signature = functions.get(function_name(material))
    problem = signature and function_problems(material, signature)
    if problem:
        return {**result, "error": problem}
    returned = []
    try:
        if kind == "strain":
            umat = strain(file, material, returned)
        else:
            umat = hyperelastic(file, material)
        evaluate(umat)
    except (Exception, SystemExit) as error:
        info = {**result, **error_of(error, file)}
        if kind == "strain" and isinstance(error, ValueError | IndexError):
            # e.g. of state variables unpacked from ζn of other shapes
            statevars = shapes(material.get("statevars", [0]))
            info["error"] += (
                f". It gets the state variables ζn of the shapes of statevars "
                f"{statevars!r}."
            )
        return info
    problem = kind == "strain" and statevars_problem(material, returned)
    if problem:
        return {**result, "error": problem}
    return {**result, "type": describe(umat), "statevars": statevars_of(umat)}
