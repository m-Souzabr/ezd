from django.urls import path

from . import bundle_views, catalog_views, config_views, views

urlpatterns = [
    path("admin/users/", views.UserListView.as_view(), name="admin-user-list"),
    path("admin/users/<int:pk>/", views.UserDetailView.as_view(), name="admin-user-detail"),
    path(
        "admin/users/<int:pk>/reset-password/",
        views.UserResetPasswordView.as_view(),
        name="admin-user-reset-password",
    ),
    path("admin/roles/", views.RoleListView.as_view(), name="admin-role-list"),
    path("admin/roles/<int:pk>/", views.RoleDetailView.as_view(), name="admin-role-detail"),
    path("admin/audit/", views.AuditListView.as_view(), name="admin-audit-list"),
    path("admin/audit/export/", views.AuditExportView.as_view(), name="admin-audit-export"),
    path("admin/audit/types/", views.AuditTypesView.as_view(), name="admin-audit-types"),
    path(
        "admin/config/export/", bundle_views.ConfigExportView.as_view(), name="admin-config-export"
    ),
    path(
        "admin/config/import/", bundle_views.ConfigImportView.as_view(), name="admin-config-import"
    ),
    path("admin/config/reset/", bundle_views.ConfigResetView.as_view(), name="admin-config-reset"),
    path(
        "admin/config/dry-run/",
        bundle_views.ConfigDryRunView.as_view(),
        name="admin-config-dry-run",
    ),
    path(
        "admin/config/versions/diff/",
        bundle_views.ConfigVersionDiffView.as_view(),
        name="admin-config-version-diff",
    ),
    path(
        "admin/catalog/dry-run/",
        bundle_views.CatalogDryRunView.as_view(),
        name="admin-catalog-dry-run",
    ),
    path(
        "admin/catalog/versions/diff/",
        bundle_views.CatalogVersionDiffView.as_view(),
        name="admin-catalog-version-diff",
    ),
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
