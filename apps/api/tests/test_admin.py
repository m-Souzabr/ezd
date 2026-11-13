import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from projects.models import Project

User = get_user_model()


@pytest.mark.django_db
def test_admin_lists_every_account_projects_archived_included(client):
    alice = User.objects.create_user(email="alice@example.com", password="x")
    bob = User.objects.create_user(email="bob@example.com", password="x")
    Project.objects.create(owner=alice, name="Alice kitchen")
    Project.objects.create(owner=bob, name="Bob kitchen", archived_at=timezone.now())
    client.force_login(User.objects.create_superuser(email="admin@example.com", password="x"))

    page = client.get("/admin/projects/project/")

    assert page.status_code == 200
    assert b"Alice kitchen" in page.content
    assert b"Bob kitchen" in page.content


@pytest.mark.django_db
@pytest.mark.parametrize("model", ["project", "design", "designversion"])
def test_admin_pages_are_read_only(client, model):
    client.force_login(User.objects.create_superuser(email="admin@example.com", password="x"))

    assert client.get(f"/admin/projects/{model}/").status_code == 200
    assert client.get(f"/admin/projects/{model}/add/").status_code == 403


@pytest.mark.django_db
def test_non_staff_cannot_open_the_admin(client):
    client.force_login(User.objects.create_user(email="alice@example.com", password="x"))

    assert client.get("/admin/projects/project/").status_code == 302
