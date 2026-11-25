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
    # (ADR 0016), the model in float32 nearly (#297)
    double = benchmark(n=3, num=2)
    single = benchmark(n=3, num=2, precision="single")
    model = benchmark(n=3, num=2, precision="model")
    assert [r["precision"] for r in (double, single, model)] == [
        "double",
        "single",
        "model",
    ]
    assert abs(single["force"] - double["force"]) < 1e-6 * double["force"]
    assert abs(model["force"] - double["force"]) < 1e-4 * double["force"]


def test_benchmark_with_pardiso():
    # PARDISO of Intel oneMKL (#308), where pypardiso is installed: the force of
    # SuperLU
    pytest.importorskip("pypardiso")
    superlu = benchmark(n=3, num=2)
    pardiso = benchmark(n=3, num=2, solver="pardiso")
    assert (superlu["solver"], pardiso["solver"]) == ("superlu", "pardiso")
    assert abs(pardiso["force"] - superlu["force"]) < 1e-10 * superlu["force"]


def test_benchmark_of_the_ways_of_u_p_j():
    # the nearly incompressible cube (Neo-Hooke, K = 5000) in the ways of u-p-J
    # (#420): the same force, the mixed fields with the pressure and the volume ratio
    # of every cell as unknowns
    ways = ["u-p-J", "u-p-J-condensed", "u-p-J-mixed", "u-p-J-three-field"]
    results = [benchmark(n=3, num=2, formulation=way) for way in ways]
    assert [r["formulation"] for r in results] == ways
    assert [r["dofs"] for r in results] == [81, 81, 81 + 2 * 8, 81 + 2 * 8]
    forces = [r["force"] for r in results]
    assert max(forces) - min(forces) < 1e-6 * forces[0]
    assert all(r["iterations"] > 0 for r in results)
    # the compressible cube of the displacements by default
    assert benchmark(n=3, num=2)["formulation"] is None
