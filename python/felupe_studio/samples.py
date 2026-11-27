"""Samples: folders of projects that describe themselves (#350).

A folder of samples has a folder per sample. The folders are sorted by their names;
a prefix of digits and ``_`` (e.g. ``01_``) gives the order and is not a part of the
id, so ``16_engine-mount`` is the sample ``engine-mount``. A sample folder has

- ``model.felupe.json``: the project; the mesh files and scripts that it names
  (``mesh.import``, ``mesh.script``, ``material.script``) must be in the folder;
- ``sample.json`` (optional): its ``title``, ``description`` and ``topics``; without
  a title, the title follows from the id;
- ``thumbnail.svg`` (optional): its picture.

Folders whose names start with ``.`` or ``_`` are left out, e.g. ``__pycache__``.
The upstream samples are ``app/samples`` of the repository and ``data/samples`` of
the package; a build of the app takes another folder with ``SAMPLES_DIR``. The
reader of the build, ``app/src/vite/samples.ts``, has the same rules and messages,
tested with ``tests/data/sample_folder_cases.json``.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .commands import file_names
from .project import ProjectError, loads

PROJECT = "model.felupe.json"
DESCRIPTION = "sample.json"
THUMBNAIL = "thumbnail.svg"

PREFIX = re.compile(r"^\d+_")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
KEYS = {"title": str, "description": str, "topics": list}


class SamplesError(ValueError):
    """A folder of samples breaks the rules; the message says how."""


@dataclass(frozen=True)
class Sample:
    """A sample of a folder of samples."""

    id: str
    folder: str
    title: str
    description: str
    topics: tuple[str, ...]
    files: tuple[str, ...]
    thumbnail: bool

    def as_dict(self):
        """The sample as JSON, like an entry of the list of the app."""
        return {
            "id": self.id,
            "folder": self.folder,
            "title": self.title,
            "description": self.description,
            "topics": list(self.topics),
            "files": list(self.files),
            "thumbnail": self.thumbnail,
        }


def title_of(sample_id):
    """The title of a sample from its id, e.g. "Engine mount" of "engine-mount"."""
    words = re.sub(r"[-_]+", " ", sample_id).strip()
    return words[:1].upper() + words[1:]


def _description(folder, sample_id):
    path = folder / DESCRIPTION
    if not path.is_file():
        return {}
    try:
        description = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SamplesError(
            f"the {DESCRIPTION} of the sample '{sample_id}' is not valid JSON: "
            f"{error.msg}."
        ) from error
    if not isinstance(description, dict):
        raise SamplesError(
            f"the {DESCRIPTION} of the sample '{sample_id}' is not an object."
        )
    for key, value in description.items():
        kind = KEYS.get(key)
        if kind is None:
            raise SamplesError(
                f"the {DESCRIPTION} of the sample '{sample_id}' has the unknown key "
                f"'{key}'; it may have title, description and topics."
            )
        good = isinstance(value, kind) and (
            kind is not list or all(isinstance(t, str) for t in value)
        )
        if not good:
            what = "a list of texts" if kind is list else "a text"
            raise SamplesError(f"the {key} of the sample '{sample_id}' is not {what}.")
    return description


def _files(folder, sample_id):
    """The mesh files and scripts of the project of a sample, checked."""
    path = folder / PROJECT
    if not path.is_file():
        raise SamplesError(f"the sample '{sample_id}' has no {PROJECT}.")
    try:
        commands = loads(path.read_text(encoding="utf-8"))["commands"]
    except ProjectError as error:
        reason = " ".join(error.errors)
        raise SamplesError(
            f"the {PROJECT} of the sample '{sample_id}' is invalid: {reason}"
        ) from error
    files = file_names(commands)
    for file in files:
        if not (folder / file).is_file():
            raise SamplesError(f"the sample '{sample_id}' has no file '{file}'.")
    return files


def read_sample(folder):
    """The sample of a folder, checked."""
    folder = Path(folder)
    sample_id = PREFIX.sub("", folder.name)
    if not ID.match(sample_id):
        raise SamplesError(
            f"the folder '{folder.name}' has no valid id: after the prefix of "
            "digits and _, it needs letters, digits, ., _ or -."
        )
    files = _files(folder, sample_id)
    description = _description(folder, sample_id)
    return Sample(
        id=sample_id,
        folder=folder.name,
        title=description.get("title", title_of(sample_id)),
        description=description.get("description", ""),
        topics=tuple(description.get("topics", [])),
        files=tuple(files),
        thumbnail=(folder / THUMBNAIL).is_file(),
    )


def read(folder):
    """The samples of a folder of samples in their order, checked. Raises a
    :class:`SamplesError` with a clear message."""
    root = Path(folder).expanduser()
    if not root.is_dir():
        raise SamplesError(f"the folder {root} does not exist.")
    names = sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and not p.name.startswith((".", "_"))
    )
    samples, folders = [], {}
    for name in names:
        sample = read_sample(root / name)
        if sample.id in folders:
            raise SamplesError(
                f"the folders '{folders[sample.id]}' and '{name}' have the same id "
                f"'{sample.id}'."
            )
        folders[sample.id] = name
        samples.append(sample)
    return samples


def find(samples, sample_id):
    """The sample with the id, or None."""
    return next((s for s in samples if s.id == sample_id), None)


def folder_of(root, sample_id):
    """The folder of the sample with the id in a folder of samples, or None."""
    sample = find(read(root), sample_id)
    return Path(root) / sample.folder if sample else None
