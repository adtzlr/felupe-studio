"""The pictures of the samples of a folder of samples (#127, #350), e.g. of a brand
(ADR 0020): ``thumbnail.svg`` of every sample, made from its project like those of
FElupe Studio (``make_samples.thumbnail``). The model is built with the default values
of its parameters, also by its mesh scripts. Run it in a clone of felupe-studio:

    python app/scripts/make_thumbnails.py <folder of samples>
"""

import sys
from pathlib import Path

from felupe_studio import samples

sys.path.insert(0, str(Path(__file__).parent))

from make_samples import thumbnail  # noqa: E402


def main(folder):
    for sample in samples.read(folder):
        path = Path(folder) / sample.folder / samples.THUMBNAIL
        path.write_text(thumbnail(path.parent), encoding="utf-8")
        print(path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
