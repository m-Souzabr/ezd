"""Pagination for every list endpoint, without changing the shape of a list.

A list is still a JSON array. `?limit=` and `?offset=` choose the page (100 rows by default,
500 at most); `X-Total-Count` gives the number of rows and `Link` the next and previous
pages, as RFC 8288 links.
"""

from typing import Any

from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


class HeaderLimitOffsetPagination(LimitOffsetPagination):
    default_limit = DEFAULT_LIMIT
    max_limit = MAX_LIMIT

    def get_paginated_response(self, data: Any) -> Response:
        response = Response(data)
        response["X-Total-Count"] = str(self.count)
        links = [
            f'<{url}>; rel="{rel}"'
            for url, rel in ((self.get_next_link(), "next"), (self.get_previous_link(), "prev"))
            if url
        ]
        if links:
            response["Link"] = ", ".join(links)
        return response

    def get_paginated_response_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        return schema
