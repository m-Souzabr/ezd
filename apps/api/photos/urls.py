from django.urls import path

from . import views

urlpatterns = [
    path(
        "projects/<uuid:pk>/photos/",
        views.ProjectPhotoListView.as_view(),
        name="project-photo-list",
    ),
    path("photos/<uuid:pk>/", views.PhotoDetailView.as_view(), name="photo-detail"),
    path("photos/<uuid:pk>/file/", views.PhotoFileView.as_view(), name="photo-file"),
    path("photos/<uuid:pk>/analyze/", views.PhotoAnalyzeView.as_view(), name="photo-analyze"),
    path(
        "photo-drafts/<uuid:pk>/",
        views.PhotoDraftDetailView.as_view(),
        name="photo-draft-detail",
    ),
    path(
        "photo-drafts/<uuid:pk>/confirm/",
        views.PhotoDraftConfirmView.as_view(),
        name="photo-draft-confirm",
    ),
    path(
        "photo-drafts/<uuid:pk>/discard/",
        views.PhotoDraftDiscardView.as_view(),
        name="photo-draft-discard",
    ),
]
