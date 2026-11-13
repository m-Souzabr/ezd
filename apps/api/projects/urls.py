from django.urls import path

from . import views

urlpatterns = [
    path("projects/", views.ProjectListView.as_view(), name="project-list"),
    path("projects/<uuid:pk>/", views.ProjectDetailView.as_view(), name="project-detail"),
    path(
        "projects/<uuid:pk>/designs/",
        views.ProjectDesignListView.as_view(),
        name="project-design-list",
    ),
    path("designs/<uuid:pk>/", views.DesignDetailView.as_view(), name="design-detail"),
    path("designs/<uuid:pk>/draft/", views.DesignDraftView.as_view(), name="design-draft"),
    path(
        "designs/<uuid:pk>/versions/",
        views.DesignVersionListView.as_view(),
        name="design-version-list",
    ),
    path(
        "designs/<uuid:pk>/versions/<int:number>/",
        views.DesignVersionDetailView.as_view(),
        name="design-version-detail",
    ),
    path(
        "designs/<uuid:pk>/versions/<int:number>/restore/",
        views.DesignVersionRestoreView.as_view(),
        name="design-version-restore",
    ),
]
