from django.urls import path

from . import views

urlpatterns = [
    path("designs/<uuid:pk>/chat/", views.DesignChatView.as_view(), name="design-chat"),
    path(
        "chat/messages/<uuid:pk>/retry/",
        views.MessageRetryView.as_view(),
        name="chat-message-retry",
    ),
    path(
        "chat/messages/<uuid:pk>/resolve/",
        views.MessageResolveView.as_view(),
        name="chat-message-resolve",
    ),
    path("chat/usage/", views.UsageView.as_view(), name="chat-usage"),
]
