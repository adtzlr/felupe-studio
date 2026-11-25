"""The Python scripts of a project, run by the worker or a server before a job: of a
mesh (#182, ADR 0009) or of a material (ADR 0025).

:func:`error_of` is the error of a script with its traceback, for the issue of its
object. :func:`inspect_material` runs the script of a material once and says what it
made, so its error is an issue of the material before a job (#423).
"""

import traceback
from pathlib import Path


def error_of(error, file):
    """The error of the script ``file`` as a dict: the ``error``, its type and its
    message, and the ``traceback`` with the frames of the script only, not those of
    FElupe Studio."""
    trace = traceback.TracebackException.from_exception(error)
    name = Path(file).name
    frames = [f for f in trace.stack if Path(f.filename).name == name]
    trace.stack = traceback.StackSummary.from_list(frames)
    return {
        "error": f"{type(error).__name__}: {error}",
        "traceback": "".join(trace.format()),
    }


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
    # a functools.partial has no name
    function = getattr(function, "__name__", None)
    return f"{name}({function})" if function else name


def inspect_material(file, parameters):
    """Run the script of a material (ADR 0025) once with the parameters as variables,
    like ``run_material_script()`` of the generated script, and summarize what it
    made: the ``type`` of its ``umat`` (:func:`describe`) and the number of its state
    variables (``statevars``), of the last array of ``umat.x`` like ``fem.SolidBody``.
    An error of the script is the ``error`` of the summary, with its ``traceback``
    (:func:`error_of`)."""
    import numpy as np

    from ._helpers import run_material_script

    result = {"file": Path(file).name}
    try:
        umat = run_material_script(file, parameters)
        # the state variables of a model without x are none, like in fem.SolidBody
        x = getattr(umat, "x", None)
        statevars = 0 if x is None else int(np.prod(np.shape(x[-1])))
    except (Exception, SystemExit) as error:
        return {**result, **error_of(error, file)}
    return {**result, "type": describe(umat), "statevars": statevars}
