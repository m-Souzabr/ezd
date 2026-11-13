from django.urls import path

from . import catalog_views, config_views, views

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
    path("catalog/", catalog_views.PublicCatalogView.as_view(), name="catalog"),
    path(
        "catalog/<str:version>/",
        catalog_views.PublicCatalogVersionView.as_view(),
        name="catalog-version",
    ),
    path(
        "admin/catalog/draft/", catalog_views.CatalogDraftView.as_view(), name="admin-catalog-draft"
    ),
    path(
        "admin/catalog/validate/",
        catalog_views.CatalogValidateView.as_view(),
        name="admin-catalog-validate",
    ),
    path(
        "admin/catalog/publish/",
        catalog_views.CatalogPublishView.as_view(),
        name="admin-catalog-publish",
    ),
    path(
        "admin/catalog/versions/",
        catalog_views.CatalogVersionListView.as_view(),
        name="admin-catalog-versions",
    ),
    path(
        "admin/catalog/versions/<str:version>/rollback/",
        catalog_views.CatalogRollbackView.as_view(),
        name="admin-catalog-rollback",
    ),
    path(
        "admin/catalog/entries/",
        catalog_views.CatalogEntryListView.as_view(),
        name="admin-catalog-entry-list",
    ),
    path(
        "admin/catalog/entries/<str:entry_id>/",
        catalog_views.CatalogEntryDetailView.as_view(),
        name="admin-catalog-entry-detail",
    ),
    path(
        "admin/catalog/entries/<str:entry_id>/retire/",
        catalog_views.CatalogEntryRetireView.as_view(),
        name="admin-catalog-entry-retire",
    ),
    path(
        "admin/catalog/entries/<str:entry_id>/restore/",
        catalog_views.CatalogEntryRestoreView.as_view(),
        name="admin-catalog-entry-restore",
    ),
    path(
        "admin/catalog/finishes/",
        catalog_views.CatalogFinishListView.as_view(),
        name="admin-catalog-finish-list",
    ),
    path(
        "admin/catalog/finishes/<str:finish_id>/",
        catalog_views.CatalogFinishDetailView.as_view(),
        name="admin-catalog-finish-detail",
    ),
    path(
        "admin/catalog/finishes/<str:finish_id>/retire/",
        catalog_views.CatalogFinishRetireView.as_view(),
        name="admin-catalog-finish-retire",
    ),
    path(
        "admin/catalog/finishes/<str:finish_id>/restore/",
        catalog_views.CatalogFinishRestoreView.as_view(),
        name="admin-catalog-finish-restore",
    ),
]
