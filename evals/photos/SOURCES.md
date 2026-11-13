# Photo test set: sources and usage rights

Every image in this directory is a synthetic kitchen scene drawn by
[`generate.py`](generate.py) from the specs in its `SCENES` list. No camera, stock library
or third-party image was used. The images and their ground truth are original work of the
EZDesign project and are covered by the repository's own license. Regenerate them with:

```sh
cd apps/api && uv run python ../../evals/photos/generate.py
```

| Photo                    | Source                                          | Usage right   |
| ------------------------ | ----------------------------------------------- | ------------- |
| `single-wall-basic.jpg`  | Drawn by `generate.py`                          | Project-owned |
| `single-wall-fridge.jpg` | Drawn by `generate.py`                          | Project-owned |
| `single-wall-pantry.jpg` | Drawn by `generate.py`                          | Project-owned |
| `single-wall-text.jpg`   | Drawn by `generate.py` (with an injection sign) | Project-owned |
| `l-shape-window.jpg`     | Drawn by `generate.py`                          | Project-owned |
| `l-shape-fridge.jpg`     | Drawn by `generate.py`                          | Project-owned |
| `l-shape-door.jpg`       | Drawn by `generate.py`                          | Project-owned |
| `u-shape-basic.jpg`      | Drawn by `generate.py`                          | Project-owned |
| `u-shape-fridge.jpg`     | Drawn by `generate.py`                          | Project-owned |
| `galley-basic.jpg`       | Drawn by `generate.py`                          | Project-owned |
| `galley-window.jpg`      | Drawn by `generate.py`                          | Project-owned |
| `rectangle-door.jpg`     | Drawn by `generate.py`                          | Project-owned |

## Adding real photos

Synthetic scenes exercise the pipeline and give a floor for recognition, but they are
cleaner than real kitchens. Add real photos as they become available:

- Only photos the team took, or photos under a license that allows this use (CC0, CC BY
  with attribution here, or the photographer's written permission). Add a row above with
  the photographer or source URL and the license.
- Strip location metadata before committing (the upload path strips it, but the files here
  are committed as they are).
- Write `<name>.json` with the ground truth: `{ "shape", "walls": [{ "lengthIn",
"openings": [kind], "items": [category] }] }`, walls left to right as the photo shows them.
- Record a fake answer in `recordings/fake/<name>.json` so CI keeps running every photo.

## Recordings

`recordings/fake/` holds scripted answers for `--client fake`. They are derived from the
ground truth with a few deliberate mistakes (a missed hood, a wrong shape, a missed window, a
passage taken for a door) and two answers that fail the schema first, so CI runs the
scoring, the retry sequence and the conversion. `--client live --record` writes real answers
to `recordings/<vendor>/`.
