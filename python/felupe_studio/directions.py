"""The directions of the constraints in local coordinates, like
``app/src/core/directions.ts``: of a Cartesian constraint (#421) the base vectors 1, 2
and 3 of its coordinate system, of a cylindrical constraint (#422) r, theta and z
about its axis. Their values are one number for all constrained directions or one
per constrained direction; a step ramps them like a boundary, and they may be the
curve of a job.
"""

# the directions of the commands, in the order of the components of FElupe
DIRECTIONS = {
    "cartesian.add": ("1", "2", "3"),
    "cylindrical.add": ("r", "theta", "z"),
}

# the names of the commands in the messages
NAMES = {
    "cartesian.add": "Cartesian constraint",
    "cylindrical.add": "cylindrical constraint",
}


def directions(command, dim=3):
    """The directions of a constraint in a model of ``dim`` dimensions: of a 2D
    model 1 and 2, or r and theta.

    Examples
    --------
    >>> directions({"command": "cylindrical.add"}, dim=2)
    ('r', 'theta')
    """
    return DIRECTIONS[command["command"]][:dim]


def components(command, values, dim=3):
    """The values of the directions of a constraint, one per direction of the model:
    the given values of the constrained directions (one value for all of them, or one
    per constrained direction in the order of the directions) and 0 of the free ones.

    Examples
    --------
    >>> components({"command": "cartesian.add", "constrained": ["3", "1"]}, 0.5)
    [0.5, 0, 0.5]
    >>> components({"command": "cartesian.add", "constrained": ["1", "3"]}, [0.1, -2])
    [0.1, 0, -2]
    >>> components({"command": "cylindrical.add", "constrained": ["theta"]}, 1, dim=2)
    [0, 1]
    """
    constrained = [d for d in directions(command, dim) if d in command["constrained"]]
    if not isinstance(values, list):
        values = [values] * len(constrained)
    given = dict(zip(constrained, values, strict=True))
    return [given.get(d, 0) for d in directions(command, dim)]


def skip(command, dim=3):
    """The flags of FElupe of the free directions of a constraint, as integers.

    Examples
    --------
    >>> skip({"command": "cylindrical.add", "constrained": ["r"]})
    (0, 1, 1)
    """
    return tuple(int(d not in command["constrained"]) for d in directions(command, dim))


def first_moved(commands, command, dim=3):
    """The index of the direction of the curve of a constraint by default, like
    ``preferredSeries()`` of the app: of its constrained directions the first that its
    value or a ramp of a step moves, else the first one. ``commands`` have the values
    of their expressions.

    Examples
    --------
    >>> twist = {"command": "cylindrical.add", "name": "twist",
    ...          "constrained": ["r", "theta"]}
    >>> step = {"command": "step.add", "name": "turn",
    ...         "ramp": {"num": 2, "items": [{"target": "twist", "end": [0, 1]}]}}
    >>> first_moved([twist, step], twist)
    1
    >>> first_moved([twist], twist)
    0
    """
    values = [components(command, command.get("value", 0), dim)]
    for step in commands:
        if step["command"] != "step.add":
            continue
        for item in step.get("ramp", {}).get("items", []):
            if item["target"] == command["name"]:
                values += [
                    components(command, item.get("start", 0), dim),
                    components(command, item["end"], dim),
                ]
    indices = [
        k for k, d in enumerate(directions(command, dim)) if d in command["constrained"]
    ]
    moved = [k for k in indices if any(float(v[k]) != 0 for v in values)]
    return (moved or indices)[0]
