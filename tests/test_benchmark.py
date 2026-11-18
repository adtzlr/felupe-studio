import pytest

from felupe_studio.benchmark import benchmark


@pytest.mark.parametrize("n", [2, 3])
def test_benchmark(n):
    res = benchmark(n=n, num=2)

    assert res["points"] == n**3
    assert res["cells"] == (n - 1) ** 3
    assert res["dofs"] == 3 * n**3
    assert res["setup"] > 0 and res["solve"] > 0
    assert res["force"] > 0


def test_benchmark_force_similar_for_coarse_and_fine_mesh():
    # the clamped ends make the deformation inhomogeneous, so the force changes
    # with the mesh, but it must stay in the same range
    coarse = benchmark(n=2, num=2)["force"]
    fine = benchmark(n=4, num=2)["force"]
    assert abs(fine - coarse) / coarse < 0.2


def test_benchmark_in_single_precision():
    # the linear equation system in float32 gives the force of double precision
    # (ADR 0016)
    double = benchmark(n=3, num=2)
    single = benchmark(n=3, num=2, precision="single")
    assert double["precision"] == "double" and single["precision"] == "single"
    assert abs(single["force"] - double["force"]) < 1e-6 * double["force"]
