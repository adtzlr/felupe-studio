"""A user-defined material of FElupe Studio: a constitutive model (ADR 0025).

FElupe Studio runs this script with the parameters of the model as variables, here
mu and bulk, and takes its variable umat: a constitutive model of FElupe with the
methods gradient and hessian. Its bulk modulus is a volumetric part of its own, so
the sections take it with the displacement formulation u (Volumetric part: on).
"""

import felupe as fem

# the parameters of the model, or these values if the script runs alone
mu = globals().get("mu", 1.0)
bulk = globals().get("bulk", 5000.0)

umat = fem.NeoHooke(mu=mu, bulk=bulk)

# Any constitutive model of FElupe works, e.g. a strain energy function of
# tensortrax with a volumetric part:
#
#     umat = fem.Hyperelastic(fem.mooney_rivlin, C10=0.4, C01=0.1) & fem.Volumetric(
#         bulk=bulk
#     )
#
# or an object of a class of your own with the methods gradient and hessian. Their
# argument x is the list of the deformation gradient F and of the state variables
# (the last item), at every quadrature point of every cell; x of the object gives
# their shapes:
#
#     import numpy as np
#
#     class Material:
#         def __init__(self, mu, bulk):
#             self.mu, self.bulk = mu, bulk
#             self.x = [np.eye(3), np.zeros(0)]  # F and no state variables
#
#         def gradient(self, x):
#             F, statevars = x[0], x[-1]
#             P = ...  # the first Piola-Kirchhoff stress, of shape (3, 3, q, c)
#             return [P, statevars]  # and the state variables of the new state
#
#         def hessian(self, x):
#             F, statevars = x[0], x[-1]
#             A = ...  # the derivative of P by F, of shape (3, 3, 3, 3, q, c)
#             return [A]
#
#     umat = Material(mu=mu, bulk=bulk)
