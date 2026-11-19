"""The lines of the objects of a command list in its script, for the script view of
the app (#130).

The lines are found in the syntax tree of the script, independent of the parts of the
script (ADR 0018): an object owns its assignment and the parts of other statements
that are about it, e.g. an entry of the boundaries or the evaluation of a job.
"""

import ast


def _names(node):
    """The names that an expression reads."""
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}


# the prefixes of the names of the objects of a command in the script, e.g. the
# solid body of a section
PREFIXES = [
    ("region_", "section.add"),
    ("field_", "section.add"),
    ("region_", "faceset.add"),
    ("field_", "faceset.add"),
    ("solid_", "section.add"),
    ("ramp_", "step.add"),
]


class _ObjectLines:
    """The ranges of the lines of the objects of a command list in a script, from
    the statements of its syntax tree."""

    def __init__(self, commands):
        self.kinds = {c["name"]: c["command"] for c in commands}
        vertices = ("point.add", "rigid.add")
        controls = [c["name"] for c in commands if c["command"] in vertices]
        merge = [c["name"] for c in commands if c["command"] == "mesh.merge"]
        # the objects of the names of several commands
        self.shared = {
            "region_control_points": controls,
            "field_control_points": controls,
            "field": merge,
        }
        self.ranges = {}

    def add(self, name, first, last):
        self.ranges.setdefault(name, []).append([first, last])

    def owners(self, target):
        """The objects of an assigned name, e.g. a section of its solid body."""
        if target in self.kinds:
            return [target]
        if target in self.shared:
            return self.shared[target]
        for prefix, kind in PREFIXES:
            name = target.removeprefix(prefix)
            if target.startswith(prefix) and self.kinds.get(name) == kind:
                return [name]
        return []

    def owned(self, target, statement):
        for name in self.owners(target):
            self.add(name, statement.lineno, statement.end_lineno)

    def statement(self, statement):
        """The objects of an assignment or of a call of a method of an object, e.g.
        ``job.evaluate(...)`` or ``field_top.link(...)``."""
        if isinstance(statement, ast.Assign):
            for target in statement.targets:
                self.assignment(statement, target)
        elif isinstance(statement, (ast.AugAssign, ast.AnnAssign)):
            self.assignment(statement, statement.target)
        elif isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call):
            func = statement.value.func
            if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
                self.owned(func.value.id, statement)

    def assignment(self, statement, target):
        if isinstance(target, ast.Subscript):
            target = target.value  # e.g. the ids of a point set
        if not isinstance(target, ast.Name):
            return
        if target.id == "boundaries" and isinstance(statement.value, ast.Dict):
            self.boundaries(statement.value)
        else:
            self.owned(target.id, statement)

    def boundaries(self, value):
        """An entry per boundary, and the boundaries of the load cases."""
        for key, entry in zip(value.keys, value.values, strict=True):
            if isinstance(key, ast.Constant) and key.value in self.kinds:
                self.add(key.value, key.lineno, entry.end_lineno)
            elif key is None:
                for name in sorted(_names(entry) & self.kinds.keys()):
                    self.add(name, entry.lineno, entry.end_lineno)

    def joined(self):
        """The sorted ranges of every object, joined where they touch."""
        lines = {}
        for name, ranges in self.ranges.items():
            joined = []
            for first, last in sorted(ranges):
                if joined and first <= joined[-1][1] + 1:
                    joined[-1][1] = max(joined[-1][1], last)
                else:
                    joined.append([first, last])
            lines[name] = joined
        return lines


def object_lines(script, document):
    """Return the lines of a generated script that belong to the objects of the
    command list, for the script view of the app (#130).

    Parameters
    ----------
    script : str
        The script of :func:`codegen`.
    document : dict
        The command list of the script.

    Returns
    -------
    dict
        The ranges ``[first, last]`` of the lines (counted from 1) of every object
        with lines, e.g. ``{"rubber": [[30, 30]], "block": [[25, 25], [52, 57]]}``:
        its assignment, and the parts of other statements that are about it (an
        entry of the boundaries, the evaluation of a job). Lines that are about
        several objects (e.g. the merge of the fields) belong to none of them.
    """
    commands = document["commands"]
    lines = _ObjectLines(commands)
    # the comments of the units of the model settings and of the type of a 2D model
    # (#175), not in the syntax tree
    settings = [c["name"] for c in commands if c["command"] == "model.settings"]
    comments = ("# units: ", "# axisymmetric: ", "# plane strain in ")
    for number, line in enumerate(script.splitlines(), start=1):
        if settings and line.startswith(comments):
            lines.add(settings[0], number, number)
    for statement in ast.parse(script).body:
        lines.statement(statement)
    return lines.joined()
