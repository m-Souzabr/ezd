from django.urls import path

from . import views

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
]
