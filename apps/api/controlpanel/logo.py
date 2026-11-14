"""Checking and re-encoding the logo of a quote, as is done for a photo.

The type comes from the content, never from what the data URI says it is. The image is
decoded, copied onto a fresh RGB image (so no metadata survives), shrunk to `LOGO_MAX_EDGE`
and saved again as the same type: an RGB PNG without an alpha channel, or a JPEG. That is
what the PDF embeds, so the PDF is the same every time.
"""

import base64
import binascii
import io
import warnings

from django.conf import settings
from PIL import Image, UnidentifiedImageError

MAX_LOGO_BYTES = 150_000
JPEG_QUALITY = 90
TYPES = {"image/png": "PNG", "image/jpeg": "JPEG"}


class InvalidLogo(ValueError):
    """The logo cannot be stored. The message is safe to show."""


def _decode(logo: str) -> bytes:
    try:
        header, encoded = logo.split(",", 1)
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise InvalidLogo("The logo is not valid base64.") from error
    if not header.startswith("data:image/") or ";base64" not in header:
        raise InvalidLogo("The logo is not valid base64.")
    if len(data) > MAX_LOGO_BYTES:
        raise InvalidLogo("The logo is larger than 150 KB.")
    return data


def process_logo(logo: str) -> str:
    """The logo as it is stored (a data URI), or raises `InvalidLogo`."""
    declared = TYPES.get(logo.split(";", 1)[0].removeprefix("data:"))
    if declared is None:
        raise InvalidLogo("The logo is not a PNG or JPEG image.")
    data = _decode(logo)
    noun = "PNG" if declared == "PNG" else "JPEG"
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(data))
            if image.format != declared:
                raise InvalidLogo(f"The logo is not a {noun} image.")
            if image.width * image.height > settings.LOGO_MAX_PIXELS:
                raise InvalidLogo("The logo has too many pixels. Use a smaller image.")
            image.load()
        except InvalidLogo:
            raise
        except (Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
            raise InvalidLogo("The logo has too many pixels. Use a smaller image.") from error
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as error:
            raise InvalidLogo(f"The logo is not a {noun} image.") from error
    if declared == "PNG" and (
        image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    ):
        raise InvalidLogo("The logo is an RGB PNG without an alpha channel, or a JPEG.")

    rgb = image.convert("RGB")
    rgb.thumbnail((settings.LOGO_MAX_EDGE, settings.LOGO_MAX_EDGE), Image.Resampling.LANCZOS)
    # A new image carries none of the source's `info`: no EXIF, ICC profile or comments.
    clean = Image.new("RGB", rgb.size)
    clean.paste(rgb)
    out = io.BytesIO()
    if declared == "PNG":
        clean.save(out, "PNG", optimize=True)
    else:
        clean.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    stored = out.getvalue()
    if len(stored) > MAX_LOGO_BYTES:
        raise InvalidLogo("The logo is larger than 150 KB.")
    mime = "image/png" if declared == "PNG" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(stored).decode()}"
