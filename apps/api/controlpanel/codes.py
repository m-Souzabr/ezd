"""The Control Panel's permission codes and the roles seeded with them."""

CATALOG_EDIT = "config.catalog.edit"
CATALOG_PUBLISH = "config.catalog.publish"
RULES_EDIT = "config.rules.edit"
APP_EDIT = "config.app.edit"
QUOTE_EDIT = "config.quote.edit"
LLM_EDIT = "llm.settings.edit"
USERS_VIEW = "users.view"
USERS_MANAGE = "users.manage"
USERS_ROLES_ASSIGN = "users.roles.assign"
AUDIT_VIEW = "audit.view"

PERMISSION_CHOICES = (
    (CATALOG_EDIT, "Edit the catalog"),
    (CATALOG_PUBLISH, "Publish the catalog"),
    (RULES_EDIT, "Edit the rules"),
    (APP_EDIT, "Edit the app settings"),
    (QUOTE_EDIT, "Edit the quote defaults"),
    (LLM_EDIT, "Edit the AI settings"),
    (USERS_VIEW, "View users"),
    (USERS_MANAGE, "Manage users"),
    (USERS_ROLES_ASSIGN, "Assign roles"),
    (AUDIT_VIEW, "View the audit log"),
)
ALL_CODES = tuple(code for code, _ in PERMISSION_CHOICES)

ADMINISTRATOR = "Administrator"
CATALOG_EDITOR = "Catalog editor"
SUPPORT = "Support"

ROLES = {
    ADMINISTRATOR: ALL_CODES,
    CATALOG_EDITOR: (CATALOG_EDIT, CATALOG_PUBLISH),
    SUPPORT: (USERS_VIEW, USERS_MANAGE),
}
