"""A user-defined material of FElupe Studio: a strain-based function (#425).

FElupe Studio takes the function material of this file as the material
fem.MaterialStrain(material, E=..., nu=...), in the framework of the material, e.g.
small strain. The arguments after dε, εn, σn and ζn, here E and nu, are fields of the
material: a number or an expression of the parameters of the model each.

The function gets the increment of the strain dε, the strain εn, the stress σn and
the state variables ζn of the last converged state, at every quadrature point of
every cell. It returns the tangent dσdε (only if kwargs["tangent"] is true), the new
stress σ and the new state variables ζ. A strain-based material has a volumetric
part, so the sections take it with the displacement formulation u.
"""

from felupe.constitution import lame_converter
from felupe.math import cdya_ik, dya, identity, trace


def material(dε, εn, σn, ζn, E, nu, **kwargs):
    "Linear elastic, of Young's modulus E and Poisson's ratio nu."
    λ, μ = lame_converter(E, nu)
    # of the data type of dε, so a model in single precision stays in it
    eye = identity(dε)
    σ = σn + 2 * μ * dε + λ * trace(dε) * eye
    dσdε = None
    if kwargs["tangent"]:
        dσdε = 2 * μ * cdya_ik(eye, eye) + λ * dya(eye, eye)
    # no state variables: the old ones, statevars (0,) of the material
    return dσdε, σ, ζn


# A function with state variables, e.g. of plasticity, takes them as the list ζn, in
# the shapes of statevars of the material, e.g. (1, (3, 3)) for a scalar and a
# tensor, and returns their new values as the list ζ:
#
#     def material(dε, εn, σn, ζn, E, nu, σy, K, **kwargs):
#         α, εp = ζn  # the equivalent plastic strain and the plastic strain tensor
#         ...
#         return dσdε, σ, [α_new, εp_new]
