"""The bar of the golden cases, one unit along -x: the mesh tools move it back."""

import felupe as fem

mesh = fem.Cube(a=(-1, 0, 0), b=(2, 1, 1), n=(13, 5, 5))
