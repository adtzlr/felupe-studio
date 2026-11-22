"""The results of a job read back from a file (#414): the XDMF time series of
:func:`felupe_studio.results.export`, which the app shows like the results of a run.

The file has the points that the cells use, the cells of the sections and, per
substep (a time of the file), the displacements at the points and the strains, the
stresses and the state variables at the cells, also at the points if they were
exported at the points (#231). meshio reads the cells of neighbouring sections of
the same cell type as one block, so the cell data ``Section``, the index of the
section of every cell, tells them apart.

The names of the sections and the units of the model are the ``Information`` of the
export (:data:`felupe_studio.results.INFORMATION`), which ParaView ignores. A file
without it, e.g. of FElupe Studio 0.10, has the sections ``Section 0``,
``Section 1``, … (the values of ``Section``, as in ParaView) and no units.
"""

import json
import os
import tempfile
import xml.etree.ElementTree as ET

import numpy as np

from . import results
from .analysis import CELLS_3D

# the names of the data of the exports by kind
NAMES = {
    kind: name for name, kind in {**results.EXPORTED, **results.EXPORTED_STATE}.items()
}


def load(name, data):
    """Read the results of an XDMF file and show them instead of the results of the
    last run (:func:`felupe_studio.results.show`).

    Parameters
    ----------
    name : str
        The name of the file; without its extension, the name of the job.
    data : bytes
        The content of the file.

    Returns
    -------
    str
        The JSON text of the description of the results, see
        :attr:`ResultFile.description`.
    """
    file = read(name, data)
    results.show(file)
    return json.dumps(file.description)


def read(name, data):
    """Return the results of an XDMF file (:class:`ResultFile`), of its name and its
    content."""
    import meshio

    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "results.xdmf")
        with open(path, "wb") as file:
            file.write(data)
        try:
            with meshio.xdmf.TimeSeriesReader(path) as reader:
                points, blocks = reader.read_points_cells()
                steps = [reader.read_data(k)[1:] for k in range(reader.num_steps)]
                information = _information(reader.domain)
        except (ET.ParseError, meshio.ReadError) as error:
            raise ValueError(f"{name} is not an XDMF time series.") from error
    return ResultFile(name, points, blocks, steps, information)


def _information(domain):
    """Return the information of the export of the domain of a file (empty without
    it)."""
    for element in domain.findall("Information"):
        if element.get("Name") == results.INFORMATION:
            return json.loads(element.get("Value", "{}"))
    return {}


def _columns(values):
    """Return values with a component per column, also of scalars."""
    values = np.asarray(values)
    return values.reshape(len(values), -1)


def _sections(blocks, index):
    """Return the cell type, the cells and the indices of the cells in the file of
    every section, by the index of the section (the cell data ``Section``)."""
    sections = {}
    offset = 0
    for block in blocks:
        numbers = index[offset : offset + len(block.data)]
        for number in np.unique(numbers):
            if number in sections:
                raise ValueError(f"Section {number} has cells of two cell types.")
            chosen = np.flatnonzero(numbers == number)
            sections[number] = (block.type, block.data[chosen], offset + chosen)
        offset += len(block.data)
    return sections


class ResultFile:
    """The results of a job of an XDMF file: the cells of its sections, and the
    displacements, the strains, the stresses and the state variables of every
    substep. They have the methods of the results of a run that the scenes and the
    ranges take (:func:`felupe_studio.results.show`).

    Parameters
    ----------
    name : str
        The name of the file; without its extension, the name of the job.
    points : ndarray
        The points of the file.
    blocks : list of meshio.CellBlock
        The blocks of cells of the file.
    steps : list of tuple
        The point data and the cell data of every time step of the file.
    information : dict
        The information of the export: the names of the ``sections`` and the
        ``units`` of the model, if any.
    """

    def __init__(self, name, points, blocks, steps, information):
        if not steps:
            raise ValueError(f"{name} has no time steps.")
        point_data, cell_data = steps[0]
        for data, key, kind in (
            (point_data, "Displacement", "point data"),
            (cell_data, "Section", "cell data"),
        ):
            if key not in data:
                raise ValueError(f"{name} has no {kind} '{key}' of results.")
        self.name = name
        self.job = os.path.splitext(os.path.basename(name))[0]
        sections = _sections(blocks, np.concatenate(cell_data["Section"]).astype(int))
        names = information.get("sections") or []

        def section(number):
            return names[number] if number < len(names) else f"Section {number}"

        self.sections = [section(number) for number in sorted(sections)]
        # the cell type, the cells and their indices in the file, by section
        self.blocks = {section(number): block for number, block in sections.items()}
        self.units = information.get("units")
        # a 2D model (#175): 2D cells, the points in the plane z = 0
        self.planar = all(t not in CELLS_3D for t, _, _ in self.blocks.values())
        self.points = points[:, :2] if self.planar else points
        self.steps = [self._step(*step) for step in steps]
        self.current = self.steps[-1]
        # the strains and the stresses at the points, if they were exported there
        self.at_points = bool(self.current["points"])
        kinds = {"displacement", *self.current["cells"]}
        self.quantities = [
            quantity
            for quantity, (kind, component, _) in results.QUANTITIES.items()
            if kind in kinds
            and not (self.planar and kind == "displacement" and component == 2)
        ]

    @staticmethod
    def _step(point_data, cell_data):
        """Return the data of a substep: the displacements, and the data of every
        kind at the points and at the cells of all sections."""
        return {
            "displacement": point_data["Displacement"],
            "points": {
                kind: _columns(point_data[name])
                for kind, name in NAMES.items()
                if name in point_data
            },
            "cells": {
                kind: _columns(np.concatenate(cell_data[name]))
                for kind, name in NAMES.items()
                if name in cell_data
            },
        }

    @property
    def description(self):
        """The name of the ``file`` and of the ``job``, the number of ``substeps``,
        the names of the ``sections``, whether the model is 2D (``planar``), its
        ``units`` (or None) and the ``quantities`` of the file (keys of
        :data:`felupe_studio.results.QUANTITIES`: the displacements, not in z of a
        2D model, and those of its data)."""
        return {
            "file": self.name,
            "job": self.job,
            "substeps": len(self.steps),
            "sections": self.sections,
            "planar": self.planar,
            "units": self.units,
            "quantities": self.quantities,
        }

    def substeps(self, job):
        """Return the number of substeps of a job: of the job of the file, else 0."""
        return len(self.steps) if job == self.job else 0

    def restore(self, job, substep):
        """Take the data of a substep of the job, counted from 1."""
        if job != self.job:
            raise KeyError(f"No results of the job '{job}'.")
        if not 1 <= substep <= len(self.steps):
            raise IndexError(f"The job '{job}' has {len(self.steps)} substeps.")
        self.current = self.steps[substep - 1]

    def mesh(self, section):
        """Return the points, the cells and their cell type of a section."""
        cell_type, cells, _ = self.blocks[section]
        return self.points, cells, cell_type

    def displacement(self, section):
        """Return the displacements of the points of the current substep."""
        return self.current["displacement"]

    def data(self, kind, section, method="cells"):
        """Return the data of a kind of the current substep: of the cells of a
        section, or at the points (all points) with another method."""
        at = "cells" if method == "cells" else "points"
        data = self.current[at].get(kind)
        if data is None:
            raise KeyError(f"{self.name} has no {NAMES[kind]} at the {at}.")
        return data[self.blocks[section][2]] if at == "cells" else data

    def method(self, method):
        """Return the method of the values of the strains and the stresses: a
        method at the points takes the point data of the file, as it was exported
        (#231), if it has them; else the values are at the cells."""
        if method not in results.METHODS:
            raise ValueError(
                f"Unknown method '{method}', expected one of {results.METHODS}."
            )
        return method if self.at_points else "cells"

    @staticmethod
    def shift():
        """Whether the values can be given at the points by any method: nothing of a
        file is projected instead of shifted (#231), its values at the points are
        those of the file."""
        return True

    @staticmethod
    def control_points(job, substep):
        """Return the control points of a substep: none, they are not in the
        file."""
        return []
