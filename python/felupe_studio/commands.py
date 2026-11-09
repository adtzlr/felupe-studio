"""Command schema and validation of command lists.

A command list is a JSON document ``{"schema_version": 1, "commands": [...]}``. Every
command creates one named object; other commands reference it by its name. The
validation first checks the JSON schema and then the references between commands.
"""

import json
import keyword
from functools import cache
from importlib.resources import files

SCHEMA_VERSION = 1

# kind of object created by each command
KINDS = {
    "mesh.import": "mesh",
    "mesh.merge": "merge",
    "cellset.from_tag": "cellset",
    "cellset.from_file": "cellset",
    "material.add": "material",
    "section.add": "section",
    "pointset.add": "pointset",
    "boundary.add": "boundary",
    "step.add": "step",
    "job.add": "job",
}

# references of a command: field name -> (kind, is a list)
REFERENCES = {
    "cellset.from_tag": {"mesh": ("mesh", False)},
    "cellset.from_file": {"mesh": ("mesh", False)},
    "section.add": {"cellset": ("cellset", False), "material": ("material", False)},
    "boundary.add": {"pointset": ("pointset", False)},
    "step.add": {"sections": ("section", True)},
    "job.add": {"steps": ("step", True), "curve": ("boundary", False)},
}


# names used by the generated script, see felupe_studio.codegen
RESERVED_NAMES = {
    "fem",
    "np",
    "meshio",
    "field",
    "points",
    "boundaries",
    "REGIONS",
    "DIMENSIONS",
    "volume_cells",
    "SimpleNamespace",
}
RESERVED_PREFIXES = ("field_", "solid_", "region_", "ramp_")


class ValidationError(ValueError):
    """A command list is not valid. The messages are stored in ``errors``."""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


@cache
def schema():
    """Return the JSON schema of a command list as a dict."""
    source = files("felupe_studio").joinpath("commands.schema.json")
    return json.loads(source.read_text(encoding="utf-8"))


def _schema_errors(document):
    from jsonschema import Draft202012Validator

    validator = Draft202012Validator(schema())
    errors = sorted(validator.iter_errors(document), key=lambda e: list(e.path))
    messages = []
    for error in errors:
        path = "/".join(str(p) for p in error.absolute_path)
        messages.append(f"{path or '(document)'}: {error.message}")
    return messages


def _reference_errors(commands):
    messages = []
    defined = {}  # name -> (index, command)

    for i, cmd in enumerate(commands):
        name = cmd["name"]

        # references must point to objects of the right kind, created before
        for field, (ref_kind, is_list) in REFERENCES.get(cmd["command"], {}).items():
            if field not in cmd:
                continue
            for ref in cmd[field] if is_list else [cmd[field]]:
                if ref not in defined:
                    messages.append(
                        f"commands/{i}: {cmd['command']} '{name}' references "
                        f"unknown {ref_kind} '{ref}' in '{field}'."
                    )
                elif KINDS[defined[ref][1]["command"]] != ref_kind:
                    other = KINDS[defined[ref][1]["command"]]
                    messages.append(
                        f"commands/{i}: '{ref}' in '{field}' of '{name}' is a "
                        f"{other}, not a {ref_kind}."
                    )

        # the ramped boundary of a step
        if cmd["command"] == "step.add" and "ramp" in cmd:
            ref = cmd["ramp"]["boundary"]
            if ref not in defined or KINDS[defined[ref][1]["command"]] != "boundary":
                messages.append(
                    f"commands/{i}: step '{name}' ramps unknown boundary '{ref}'."
                )

        # cell sets from tags need a mesh imported with a tag
        if cmd["command"] == "cellset.from_tag" and cmd["mesh"] in defined:
            mesh = defined[cmd["mesh"]][1]
            if mesh["command"] == "mesh.import" and "tag" not in mesh:
                messages.append(
                    f"commands/{i}: cell set '{name}' uses tag values, but mesh "
                    f"'{mesh['name']}' was imported without a tag."
                )

        # NeoHooke without a bulk modulus has no volumetric part
        if cmd["command"] == "section.add" and cmd["formulation"] == "u":
            material = defined.get(cmd["material"], (None, {}))[1]
            if (
                material.get("command") == "material.add"
                and material["model"] == "NeoHooke"
                and "bulk" not in material["parameters"]
            ):
                messages.append(
                    f"commands/{i}: section '{name}' uses the displacement "
                    f"formulation with NeoHooke '{material['name']}' without a bulk "
                    "modulus. Add 'bulk' to the material or use 'u-p-J'."
                )

        if cmd["command"] == "mesh.merge" and any(
            c["command"] == "mesh.merge" for _, c in defined.values()
        ):
            messages.append(f"commands/{i}: only one mesh.merge is allowed.")

        if (
            keyword.iskeyword(name)
            or name in RESERVED_NAMES
            or name.startswith(RESERVED_PREFIXES)
        ):
            messages.append(
                f"commands/{i}: name '{name}' is reserved for the generated script."
            )

        if name in defined:
            messages.append(
                f"commands/{i}: name '{name}' is already used by "
                f"commands/{defined[name][0]}."
            )
        else:
            defined[name] = (i, cmd)

    return messages


def errors(document):
    """Return a list of error messages of a command list (empty if valid)."""
    messages = _schema_errors(document)
    if messages:
        return messages
    return _reference_errors(document["commands"])


def validate(document):
    """Raise a :class:`ValidationError` if the command list is not valid."""
    messages = errors(document)
    if messages:
        raise ValidationError(messages)
    return document
