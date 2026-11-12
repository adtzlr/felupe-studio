"""The live results of a running job (#207): the points of the curve after every
converged substep and the scenes of the current fields, throttled."""

import copy
import json
from pathlib import Path

import numpy as np
import pytest

from felupe_studio import results
from felupe_studio.runner import run, run_json

GOLDEN = Path(__file__).parent / "golden"


@pytest.fixture
def bar(monkeypatch):
    """The bar of bar_single_body with a second step: 6 + 4 = 10 substeps (with the
    start of each ramp)."""
    monkeypatch.chdir(GOLDEN / "bar_single_body")
    document = json.loads((GOLDEN / "bar_single_body" / "commands.json").read_text())
    document = copy.deepcopy(document)
    step = next(c for c in document["commands"] if c["command"] == "step.add")
    back = copy.deepcopy(step)
    back["name"] = "step_2"
    back["ramp"] = {"num": 3, "items": [{"target": "move", "start": 0.5, "end": 0}]}
    document["commands"].insert(document["commands"].index(step) + 1, back)
    job = next(c for c in document["commands"] if c["command"] == "job.add")
    job["steps"] = ["step_1", "step_2"]
    return document


class Clock:
    """A fake clock: every call advances the time, by more for a scene."""

    def __init__(self, tick=0.4):
        self.time = 0.0
        self.tick = tick

    def __call__(self):
        self.time += self.tick
        return self.time


def lives(events):
    return [e for e in events if e["event"] == "live"]


def test_curve_points_of_every_substep(bar):
    events = []
    result = run(bar, events.append)["job_1"]
    live = lives(events)
    # without live settings: the points of the curve only, no scenes
    assert [e["substep"] for e in live] == list(range(1, 11))
    assert all("scene" not in e for e in live)
    assert [e["x"] for e in live] == result["x"]
    assert [e["y"] for e in live] == result["y"]


def test_scenes_are_throttled_and_equal_the_recorded_ones(bar):
    events = []
    # one tick for the substep, one for the scene: a scene at most every second
    run(bar, events.append, {"quantity": "stress_mises", "budget": 1}, Clock())
    scenes = [e for e in lives(events) if "scene" in e]
    shown = [e["substep"] for e in scenes]
    # the last substeps of both steps (6 and 10) always, others at most every second
    assert 6 in shown and 10 in shown
    assert 2 < len(shown) < 10
    for event in scenes:
        meta, surfaces = event["scene"]
        expected = results.scene("job_1", event["substep"], "stress_mises")
        assert json.loads(meta) == json.loads(expected[0])
        for live, recorded in zip(surfaces, expected[1], strict=True):
            assert live.keys() == recorded.keys()
            for key in live:
                assert live[key] == recorded[key], key


def test_scenes_take_a_share_of_the_time_at_most(bar, monkeypatch):
    # a substep costs 1 second, a scene 10: with a budget of 10 %, after the first
    # scene only those of the last substeps of the steps
    clock = Clock(tick=1)
    scene = results.current_scene

    def slow(*args):
        clock.time += 10
        return scene(*args)

    monkeypatch.setattr(results, "current_scene", slow)
    events = []
    run(bar, events.append, {"quantity": "displacement", "interval": 0}, clock)
    assert [e["substep"] for e in lives(events) if "scene" in e] == [1, 6, 10]


def test_run_json_gives_scenes_to_their_own_callback(bar):
    texts, scenes = [], []
    live = json.dumps({"quantity": "displacement", "interval": 0, "budget": 1})
    output = run_json(
        json.dumps(bar),
        texts.append,
        live,
        lambda event, meta, surfaces: scenes.append((json.loads(event), surfaces)),
    )
    assert json.loads(output)["job_1"]["substeps"] == 10
    events = [json.loads(t) for t in texts]
    assert all("scene" not in e for e in events)
    # every substep with a scene (no interval, the whole budget), with the curve
    assert [e["substep"] for e, _ in scenes] == list(range(1, 11))
    assert all("x" in e and "y" in e for e, _ in scenes)
    assert scenes[-1][1][0]["name"] == "body"
    assert np.frombuffer(scenes[-1][1][0]["values"], "<f4").size > 0
