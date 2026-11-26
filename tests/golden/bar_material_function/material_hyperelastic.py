"""A user-defined material of FElupe Studio: a strain energy function (#424).

FElupe Studio takes the function strain_energy of this file as the material
fem.Hyperelastic(strain_energy, mu=...), whose stress and elasticity tensor
tensortrax computes. The arguments after C, here mu, are fields of the material: a
number or an expression of the parameters of the model each.

The function is the isochoric part of the strain energy density, of the unimodular
right Cauchy-Green deformation tensor. With a bulk modulus K of the material, the
sections take it with the displacement formulation u, else with u-p-J.
"""

import tensortrax.math as tm


def strain_energy(C, mu):
    "The strain energy density of Neo-Hooke, of the first invariant of C."
    I1 = tm.linalg.det(C) ** (-1 / 3) * tm.trace(C)
    return mu / 2 * (I1 - 3)


# Any function of C of tensortrax works, e.g. with a term of its own:
#
#     def strain_energy(C, mu, k):
#         I1 = tm.linalg.det(C) ** (-1 / 3) * tm.trace(C)
#         return mu / 2 * (I1 - 3) + k * (I1 - 3) ** 2
#
# A function with state variables, e.g. of damage, takes them as its second argument
# statevars and returns the strain energy and their new values; set their number,
# nstatevars, in the properties of the material:
#
#     def strain_energy(C, statevars, mu):
#         ...
#         return W, statevars_new
