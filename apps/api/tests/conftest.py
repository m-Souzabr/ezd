import copy
import json
from pathlib import Path
from typing import Any

import pytest
from django.conf import settings
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import User
from llm.config import set_fake_client
from llm.fake import FakeClient
from projects.models import Design, DesignVersion, Project

FIXTURES = Path(settings.REPO_DIR) / "packages/core/src/document/fixtures"
PASSWORD = "correct-horse-battery"


def core_fixture(name: str, design_id: str | None = None) -> dict[str, Any]:
    """A core fixture document, with its id replaced when it is to be stored in a design."""
    document = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    if design_id is not None:
        document["id"] = design_id
    return document


@pytest.fixture(autouse=True)
def _clear_throttles() -> None:
    cache.clear()


@pytest.fixture(autouse=True)
def fake_llm() -> FakeClient:
    """The assistant's client in every test: answers only what a test scripts."""
    client = FakeClient()
    set_fake_client(client)
    return client


@pytest.fixture
def user(db: None) -> User:
    return User.objects.create_user(email="ada@example.com", password=PASSWORD, name="Ada")


@pytest.fixture
def other_user(db: None) -> User:
    return User.objects.create_user(email="bob@example.com", password=PASSWORD, name="Bob")


@pytest.fixture
def anonymous() -> APIClient:
    return APIClient()


@pytest.fixture
def client(user: User) -> APIClient:
    api = APIClient()
    api.force_login(user)
    return api


@pytest.fixture
def other_client(other_user: User) -> APIClient:
    api = APIClient()
    api.force_login(other_user)
    return api


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(owner=user, name="Lake house")


def make_design(project: Project, name: str = "Kitchen") -> Design:
    design = Design(project=project, name=name, schema_version=1)
    design.draft_document = core_fixture("valid", str(design.id))
    design.save()
    return design


@pytest.fixture
def design(project: Project) -> Design:
    return make_design(project)


@pytest.fixture
def version(design: Design, user: User) -> DesignVersion:
    return DesignVersion.objects.create(
        design=design,
        number=1,
        label="First",
        document=copy.deepcopy(design.draft_document),
        schema_version=1,
        created_by=user,
    )
