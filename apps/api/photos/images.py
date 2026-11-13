"""Checking and re-encoding an uploaded photo.

The type comes from the content, never the file name. Every accepted image is decoded,
turned upright by its EXIF orientation, copied onto a fresh RGB image (so no metadata,
GPS included, can survive), downscaled and saved as a JPEG.
"""

import io
import warnings
from dataclasses import dataclass

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError

ACCEPTED_FORMATS = {"JPEG": "JPEG", "PNG": "PNG", "WEBP": "WebP"}
JPEG_QUALITY = 88


class InvalidPhoto(ValueError):
    """The upload cannot be stored. The message is safe to show to the user."""


@dataclass(frozen=True)
class ProcessedPhoto:
    content: bytes
    width: int
    height: int


def _accepted() -> str:
    return ", ".join(ACCEPTED_FORMATS.values())


def process_upload(data: bytes) -> ProcessedPhoto:
    """The photo as it is stored, or `InvalidPhoto`."""
    if len(data) > settings.PHOTO_MAX_BYTES:
        raise InvalidPhoto(f"The photo is larger than {settings.PHOTO_MAX_BYTES // 2**20} MB.")
    with warnings.catch_warnings():
        # Pillow warns about a large image before it refuses a larger one; refuse both.
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(data))
            if image.format not in ACCEPTED_FORMATS:
                raise InvalidPhoto(f"The file is not a photo. Upload a {_accepted()} image.")
            width, height = image.size
            if width * height > settings.PHOTO_MAX_PIXELS:
                raise InvalidPhoto("The photo has too many pixels. Upload a smaller one.")
            image.load()
        except InvalidPhoto:
            raise
        except (Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
            raise InvalidPhoto("The photo has too many pixels. Upload a smaller one.") from error
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as error:
            raise InvalidPhoto(
                f"The file is not a photo or is damaged. Upload a {_accepted()} image."
            ) from error

    upright = ImageOps.exif_transpose(image)
    if upright.mode in ("RGBA", "LA") or (upright.mode == "P" and "transparency" in upright.info):
        rgba = upright.convert("RGBA")
        rgb = Image.new("RGB", rgba.size, "white")
        rgb.paste(rgba, mask=rgba.getchannel("A"))
    else:
        rgb = upright.convert("RGB")
    rgb.thumbnail((settings.PHOTO_MAX_EDGE, settings.PHOTO_MAX_EDGE), Image.Resampling.LANCZOS)
    # A new image carries none of the source's `info`: no EXIF, ICC profile or comments.
    clean = Image.new("RGB", rgb.size)
    clean.paste(rgb)
    out = io.BytesIO()
    clean.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return ProcessedPhoto(content=out.getvalue(), width=clean.width, height=clean.height)
