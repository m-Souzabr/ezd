import pytest
from django.db import IntegrityError, transaction

from accounts.models import User
from projects.models import Design, DesignVersion, Project


def test_a_design_starts_at_revision_one(design: Design) -> None:
    assert design.draft_revision == 1
    assert design.draft_document["id"] == str(design.id)


def test_version_numbers_are_unique_within_a_design(
    design: Design, version: DesignVersion, user: User
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        DesignVersion.objects.create(
            design=design, number=1, document={}, schema_version=1, created_by=user
        )


def test_the_same_number_is_allowed_in_another_design(
    project: Project, version: DesignVersion, user: User
) -> None:
    other = Design.objects.create(
        project=project, name="Pantry", draft_document={}, schema_version=1
    )
    DesignVersion.objects.create(
        design=other, number=1, document={}, schema_version=1, created_by=user
    )
    assert DesignVersion.objects.filter(number=1).count() == 2


def test_emails_are_unique(user: User) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(email=user.email, password="another-pass-123")


def test_for_user_leaves_out_other_accounts_and_archived_projects(
    user: User, other_user: User, design: Design, version: DesignVersion
) -> None:
    assert list(Project.objects.for_user(other_user)) == []
    assert list(Design.objects.for_user(other_user)) == []
    assert list(DesignVersion.objects.for_user(other_user)) == []
    assert list(Design.objects.for_user(user)) == [design]

    Project.objects.filter(pk=design.project_id).update(archived_at="2026-01-01T00:00:00Z")
    assert list(Project.objects.for_user(user)) == []
    assert list(Design.objects.for_user(user)) == []
    assert list(DesignVersion.objects.for_user(user)) == []


def test_indexes_named_in_the_plan_exist() -> None:
    assert [index.fields for index in Project._meta.indexes] == [["owner", "archived_at"]]
    assert Design._meta.get_field("project").db_index
