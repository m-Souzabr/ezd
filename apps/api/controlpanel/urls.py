from django.urls import path

from . import config_views, views

urlpatterns = [
    path("admin/users/", views.UserListView.as_view(), name="admin-user-list"),
    path("admin/users/<int:pk>/", views.UserDetailView.as_view(), name="admin-user-detail"),
    path(
        "admin/users/<int:pk>/reset-password/",
        views.UserResetPasswordView.as_view(),
        name="admin-user-reset-password",
    ),
    path("admin/roles/", views.RoleListView.as_view(), name="admin-role-list"),
    path("admin/audit/", views.AuditListView.as_view(), name="admin-audit-list"),
    path("config/", config_views.PublicConfigView.as_view(), name="app-config"),
    path("admin/config/draft/", config_views.ConfigDraftView.as_view(), name="admin-config-draft"),
    path(
        "admin/config/publish/",
        config_views.ConfigPublishView.as_view(),
        name="admin-config-publish",
    ),
    path(
        "admin/config/versions/",
        config_views.ConfigVersionListView.as_view(),
        name="admin-config-versions",
    ),
    path(
        "admin/config/versions/<int:number>/rollback/",
        config_views.ConfigRollbackView.as_view(),
        name="admin-config-rollback",
    ),
]
