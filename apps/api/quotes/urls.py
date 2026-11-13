from django.urls import path

from . import views

urlpatterns = [
    path(
        "designs/<uuid:pk>/quotes/", views.DesignQuoteListView.as_view(), name="design-quote-list"
    ),
    path("quotes/<uuid:pk>/", views.QuoteDetailView.as_view(), name="quote-detail"),
]
