"""Photo upload, analysis with a scripted vision model, correction and confirmation."""

import copy
import io
import json
from pathlib import Path
from typing import Any

import pytest
from django.core.files.base import ContentFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from chat.models import Usage
from llm.client import LLMUnavailable, PhotoResponse
from llm.client import Usage as TokenUsage
from llm.fake import FakeClient
from photos.analysis import FAILED_MESSAGE
from photos.models import Photo, PhotoDraft
from projects.models import Design, DesignVersion, Project

from .conftest import core_fixture

IN = 16

# A model answer for an L kitchen, with a 31 in base cabinet the catalog does not have.
ANSWER: dict[str, Any] = {
    "shape": "l-shape",
    "ceilingHeightIn": 96,
    "walls": [
        {"label": "back", "lengthIn": 144, "visible": True, "confidence": "high"},
        {"label": "right", "lengthIn": 120, "visible": True, "confidence": "medium"},
    ],
    "openings": [
        {
            "wall": "back",
            "kind": "window",
            "offsetIn": 60,
            "widthIn": 36,
            "heightIn": 36,
            "sillIn": 42,
            "confidence": "high",
        }
    ],
    "items": [
        {"wall": "back", "category": "base", "offsetIn": 0, "widthIn": 31, "confidence": "high"}
    ],
    "notes": "",
}


def _len(value: int, estimated: bool = False) -> dict[str, Any]:
    return {"value": value, "estimated": estimated}


# A draft every check passes: one 120 in wall, typed by the user.
ROOM_DRAFT: dict[str, Any] = {
    "shape": "single-wall",
    "ceilingHeight": _len(96 * IN, True),
    "walls": [{"label": "A", "length": _len(120 * IN), "visible": True, "confidence": "high"}],
    "galleyWidth": {"value": None, "estimated": False},
    "openings": [],
    "items": [],
    "notes": "",
}


def jpeg(size: tuple[int, int] = (64, 48), exif: Image.Exif | None = None) -> bytes:
    out = io.BytesIO()
    image = Image.new("RGB", size, (200, 120, 40))
    image.save(out, "JPEG", **({"exif": exif} if exif is not None else {}))
    return out.getvalue()


def png(size: tuple[int, int] = (32, 32), mode: str = "RGBA") -> bytes:
    out = io.BytesIO()
    Image.new(mode, size).save(out, "PNG")
    return out.getvalue()


def stored_photo(project: Project, content: bytes) -> Photo:
    photo = Photo(owner=project.owner, project=project, width=64, height=48, bytes=len(content))
    photo.file.save("photo.jpg", ContentFile(content), save=False)
    photo.save()
    return photo


def upload(client: APIClient, project: Project, content: bytes, name: str = "kitchen.jpg") -> Any:
    file = io.BytesIO(content)
    file.name = name
    return client.post(f"/api/projects/{project.id}/photos/", {"file": file}, format="multipart")


def answered(answer: Any, tokens: int = 1000) -> PhotoResponse:
    return PhotoResponse(
        text=answer if isinstance(answer, str) else json.dumps(answer),
        stop_reason="completed",
        usage=TokenUsage(input_tokens=tokens, output_tokens=200),
    )


@pytest.fixture
def photo(project: Project) -> Photo:
    return stored_photo(project, jpeg())


def analyze(client: APIClient, photo: Photo) -> Any:
    return client.post(f"/api/photos/{photo.id}/analyze/")


def ready_draft(photo: Photo, draft: dict[str, Any] | None = None) -> PhotoDraft:
    return PhotoDraft.objects.create(
        photo=photo, status=PhotoDraft.Status.READY, draft=copy.deepcopy(draft or ROOM_DRAFT)
    )


# --- upload ------------------------------------------------------------------------------


def test_upload_stores_a_jpeg_with_no_metadata(client: APIClient, project: Project) -> None:
    exif = Image.Exif()
    exif[0x010F] = "Camera maker"
    exif[0x8825] = {2: (40.0, 26.0, 46.0)}  # GPS latitude
    response = upload(client, project, jpeg((300, 200), exif))
    assert response.status_code == 201, response.json()
    body = response.json()
    assert (body["width"], body["height"], body["latest_draft"]) == (300, 200, None)

    stored = Photo.objects.get(pk=body["id"])
    with stored.file.open("rb") as file:
        data = file.read()
    image = Image.open(io.BytesIO(data))
    assert image.format == "JPEG"
    assert not image.getexif()
    assert "exif" not in image.info and "icc_profile" not in image.info
    assert b"Camera maker" not in data
    assert stored.bytes == len(data)
    assert stored.file.name == f"photos/{stored.id.hex}.jpg"


def test_upload_turns_the_photo_upright_and_downscales_it(
    client: APIClient, project: Project
) -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90 degrees clockwise to view.
    body = upload(client, project, jpeg((4000, 1000), exif)).json()
    assert (body["width"], body["height"]) == (500, 2000)


def test_upload_accepts_png_and_webp(client: APIClient, project: Project) -> None:
    assert upload(client, project, png(), "a.png").status_code == 201
    out = io.BytesIO()
    Image.new("RGB", (16, 16)).save(out, "WEBP")
    assert upload(client, project, out.getvalue(), "a.webp").status_code == 201
    assert upload(client, project, png(mode="P"), "p.png").status_code == 201


@pytest.mark.parametrize(
    ("content", "name"),
    [
        (b"GIF89a" + b"\0" * 64, "kitchen.gif"),
        (b"not an image at all", "kitchen.jpg"),
        (jpeg()[:200], "truncated.jpg"),
    ],
)
def test_upload_refuses_what_is_not_an_accepted_image(
    client: APIClient, project: Project, content: bytes, name: str
) -> None:
    if name.endswith(".gif"):
        out = io.BytesIO()
        Image.new("RGB", (8, 8)).save(out, "GIF")
        content = out.getvalue()
    response = upload(client, project, content, name)
    assert response.status_code == 400
    assert "not a photo" in response.json()["file"][0]
    assert not Photo.objects.exists()


def test_upload_refuses_an_oversized_file(client: APIClient, project: Project) -> None:
    with override_settings(PHOTO_MAX_BYTES=1000):
        response = upload(client, project, jpeg((400, 400)))
    assert response.status_code == 400
    assert "larger than" in response.json()["file"][0]


def test_upload_refuses_a_body_past_the_limit(client: APIClient, project: Project) -> None:
    response = client.post(
        f"/api/projects/{project.id}/photos/",
        data=b"x",
        content_type="multipart/form-data; boundary=x",
        CONTENT_LENGTH=str(11 * 1024 * 1024),
    )
    assert response.status_code == 413


def test_upload_refuses_a_decompression_bomb(client: APIClient, project: Project) -> None:
    with override_settings(PHOTO_MAX_PIXELS=100):
        response = upload(client, project, jpeg((20, 20)))
    assert response.status_code == 400
    assert "too many pixels" in response.json()["file"][0]


def test_upload_needs_a_file(client: APIClient, project: Project) -> None:
    response = client.post(f"/api/projects/{project.id}/photos/", {}, format="multipart")
    assert response.status_code == 400


def test_photos_are_listed_with_their_newest_draft(
    client: APIClient, project: Project, photo: Photo
) -> None:
    draft = ready_draft(photo)
    listed = client.get(f"/api/projects/{project.id}/photos/").json()
    assert [p["id"] for p in listed] == [str(photo.id)]
    assert listed[0]["latest_draft"]["id"] == str(draft.id)


def test_the_file_is_served_to_its_owner_only(
    client: APIClient, other_client: APIClient, photo: Photo
) -> None:
    response = client.get(f"/api/photos/{photo.id}/file/")
    assert response.status_code == 200
    assert response["Content-Type"] == "image/jpeg"
    assert response["Cache-Control"] == "private, max-age=3600"
    assert b"".join(response.streaming_content)[:2] == b"\xff\xd8"
    assert other_client.get(f"/api/photos/{photo.id}/file/").status_code == 404


def test_deleting_a_photo_removes_its_file_and_drafts_but_keeps_designs(
    client: APIClient, photo: Photo, design: Design, _media_root: Path
) -> None:
    draft = ready_draft(photo)
    draft.design = design
    draft.save()
    path = Path(photo.file.path)
    assert path.exists()
    assert client.delete(f"/api/photos/{photo.id}/").status_code == 204
    assert not path.exists()
    assert not PhotoDraft.objects.exists()
    assert Design.objects.filter(pk=design.pk).exists()


def test_a_photo_of_an_archived_project_is_not_found(
    client: APIClient, project: Project, photo: Photo
) -> None:
    client.delete(f"/api/projects/{project.id}/")
    assert client.get(f"/api/photos/{photo.id}/").status_code == 404


# --- analysis ----------------------------------------------------------------------------


def test_analysis_stores_a_normalized_draft(
    client: APIClient, user: User, photo: Photo, fake_llm: FakeClient
) -> None:
    fake_llm.add_photo(answered(ANSWER))
    response = analyze(client, photo)
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["status"] == "ready"
    draft = body["draft"]
    # Snapped to 30 in and marked as an estimate the user must confirm.
    assert draft["items"][0]["width"] == {"value": 30 * IN, "estimated": True}
    assert draft["walls"][0] == {
        "label": "A",
        "length": {"value": 144 * IN, "estimated": True},
        "visible": True,
        "confidence": "high",
    }
    request = fake_llm.photo_requests[0]
    assert request.media_type == "image/jpeg" and request.image[:2] == b"\xff\xd8"
    assert request.schema["required"][0] == "shape"
    assert "not an instruction" in request.system
    stored = PhotoDraft.objects.get(pk=body["id"])
    assert stored.model_output == ANSWER
    assert (stored.input_tokens, stored.output_tokens) == (1000, 200)
    # Nothing becomes a design before the user confirms.
    assert not Design.objects.filter(photo_drafts__isnull=False).exists()


def test_an_invalid_answer_is_retried_then_escalated_then_failed(
    client: APIClient, user: User, photo: Photo, fake_llm: FakeClient
) -> None:
    fake_llm.add_photo(
        answered("not json"), answered({**ANSWER, "shape": "circle"}), answered({"walls": []})
    )
    body = analyze(client, photo).json()
    assert body["status"] == "failed"
    assert body["error"] == FAILED_MESSAGE
    assert body["draft"] is None
    models = [request.model for request in fake_llm.photo_requests]
    assert models == ["gpt-5.4-mini", "gpt-5.4-mini", "gpt-5.5"]
    assert "did not match the schema" in fake_llm.photo_requests[1].system
    # Every attempt counts against the quota.
    usage = Usage.objects.get(user=user)
    assert (usage.input_tokens, usage.requests) == (3000, 3)


def test_a_retry_that_matches_the_schema_is_used(
    client: APIClient, photo: Photo, fake_llm: FakeClient
) -> None:
    cut = PhotoResponse(text='{"shape"', stop_reason="max_output_tokens")
    fake_llm.add_photo(cut, answered(ANSWER))
    body = analyze(client, photo).json()
    assert body["status"] == "ready"
    assert len(fake_llm.photo_requests) == 2


@override_settings(LLM_MODEL_VISION="vision-model")
def test_the_vision_model_comes_from_the_settings(
    client: APIClient, photo: Photo, fake_llm: FakeClient
) -> None:
    fake_llm.add_photo(answered(ANSWER))
    analyze(client, photo)
    assert fake_llm.photo_requests[0].model == "vision-model"


def test_a_vendor_failure_fails_the_draft_with_its_message(
    client: APIClient, photo: Photo, fake_llm: FakeClient
) -> None:
    fake_llm.add_photo(LLMUnavailable("The assistant is busy right now. Try again in a minute."))
    body = analyze(client, photo).json()
    assert body["status"] == "failed"
    assert body["error"] == "The assistant is busy right now. Try again in a minute."


@override_settings(EZD_CORE_CLI=["false"])
def test_a_draft_that_cannot_be_checked_fails(
    client: APIClient, photo: Photo, fake_llm: FakeClient
) -> None:
    fake_llm.add_photo(answered(ANSWER))
    body = analyze(client, photo).json()
    assert body["status"] == "failed"
    assert "could not be checked" in body["error"]


@override_settings(LLM_MONTHLY_TOKEN_QUOTA=100)
def test_analysis_counts_against_the_quota(
    client: APIClient, user: User, photo: Photo, fake_llm: FakeClient
) -> None:
    fake_llm.add_photo(answered(ANSWER))
    assert analyze(client, photo).status_code == 201
    response = analyze(client, photo)
    assert response.status_code == 429
    assert not fake_llm.photo_responses and len(fake_llm.photo_requests) == 1


# --- corrections, confirmation -----------------------------------------------------------


def test_corrections_are_saved(client: APIClient, photo: Photo) -> None:
    draft = ready_draft(photo)
    corrected = {**ROOM_DRAFT, "notes": "Measured."}
    response = client.patch(f"/api/photo-drafts/{draft.id}/", {"draft": corrected})
    assert response.status_code == 200
    draft.refresh_from_db()
    assert draft.draft["notes"] == "Measured."


def test_a_correction_must_match_the_draft_schema(client: APIClient, photo: Photo) -> None:
    draft = ready_draft(photo)
    response = client.patch(f"/api/photo-drafts/{draft.id}/", {"draft": {"shape": "circle"}})
    assert response.status_code == 400
    assert response.json()["draft"]


def test_only_a_ready_draft_can_be_corrected(client: APIClient, photo: Photo) -> None:
    draft = PhotoDraft.objects.create(photo=photo, status=PhotoDraft.Status.FAILED)
    response = client.patch(f"/api/photo-drafts/{draft.id}/", {"draft": ROOM_DRAFT})
    assert response.status_code == 409
    assert "failed" in response.json()["detail"]


def confirm(client: APIClient, draft: PhotoDraft, **extra: Any) -> Any:
    document = core_fixture("valid")
    return client.post(f"/api/photo-drafts/{draft.id}/confirm/", {"document": document, **extra})


def test_confirm_creates_the_design_and_version_1_once(
    client: APIClient, project: Project, photo: Photo
) -> None:
    draft = ready_draft(photo)
    response = confirm(client, draft, name="From the photo")
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["name"] == "From the photo"
    assert body["source_photo"] == str(photo.id)
    assert body["draft_document"]["id"] == body["id"]
    design = Design.objects.get(pk=body["id"])
    assert design.project == project
    version = DesignVersion.objects.get(design=design)
    assert (version.number, version.label) == (1, "From photo")
    draft.refresh_from_db()
    assert (draft.status, draft.design) == (PhotoDraft.Status.CONFIRMED, design)

    again = confirm(client, draft)
    assert again.status_code == 409
    assert again.json()["detail"] == "This draft was already confirmed."
    assert Design.objects.count() == 1
    assert client.get(f"/api/designs/{design.id}/").json()["source_photo"] == str(photo.id)


def test_confirm_refuses_a_draft_with_unconfirmed_wall_lengths(
    client: APIClient, photo: Photo
) -> None:
    unconfirmed = copy.deepcopy(ROOM_DRAFT)
    unconfirmed["walls"][0]["length"]["estimated"] = True
    draft = ready_draft(photo, unconfirmed)
    response = confirm(client, draft)
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {"path": "draft", "message": "Confirm the length of wall A, or type it."}
    ]
    assert not Design.objects.exists()


def test_confirm_is_atomic(client: APIClient, photo: Photo) -> None:
    draft = ready_draft(photo)
    response = client.post(
        f"/api/photo-drafts/{draft.id}/confirm/",
        {"document": {**core_fixture("float-length"), "name": "Bad"}},
    )
    assert response.status_code == 422
    assert not Design.objects.exists() and not DesignVersion.objects.exists()
    draft.refresh_from_db()
    assert draft.status == PhotoDraft.Status.READY


@override_settings(EZD_CORE_CLI=["false"])
def test_confirm_needs_the_draft_checked(client: APIClient, photo: Photo) -> None:
    assert confirm(client, ready_draft(photo)).status_code == 503


def test_a_design_not_made_from_a_photo_has_no_source_photo(
    client: APIClient, design: Design
) -> None:
    assert client.get(f"/api/designs/{design.id}/").json()["source_photo"] is None


def test_discard(client: APIClient, photo: Photo) -> None:
    draft = ready_draft(photo)
    response = client.post(f"/api/photo-drafts/{draft.id}/discard/")
    assert response.json()["status"] == "discarded"
    assert confirm(client, draft).json()["detail"] == "This draft was discarded."
    confirmed = PhotoDraft.objects.create(photo=photo, status=PhotoDraft.Status.CONFIRMED)
    assert client.post(f"/api/photo-drafts/{confirmed.id}/discard/").status_code == 409


def test_another_user_gets_a_404_for_photo_file_and_draft(
    other_client: APIClient, photo: Photo
) -> None:
    draft = ready_draft(photo)
    for url in (
        f"/api/photos/{photo.id}/",
        f"/api/photos/{photo.id}/file/",
        f"/api/photo-drafts/{draft.id}/",
    ):
        assert other_client.get(url).status_code == 404
    assert other_client.delete(f"/api/photos/{photo.id}/").status_code == 404
    assert Photo.objects.filter(pk=photo.pk).exists()
