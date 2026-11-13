from typing import Any

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.tokens import default_token_generator
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.api import AuthIpThrottle, LoginEmailThrottle, LoginIpThrottle
from controlpanel import appconfig

from .emails import send_reset_email
from .serializers import (
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetSerializer,
    RegisterSerializer,
    UserSerializer,
    check_password,
)

User = get_user_model()


@method_decorator(csrf_protect, name="dispatch")
class AnonymousView(APIView):
    """A view for visitors who are not signed in.

    DRF checks CSRF only for a signed-in session, so these views check it themselves. The
    web app gets the cookie from `GET /api/auth/me/` first.
    """

    permission_classes = (AllowAny,)
    throttle_classes = (AuthIpThrottle,)


class RegisterView(AnonymousView):
    @extend_schema(request=RegisterSerializer, responses={201: UserSerializer})
    def post(self, request: Request) -> Response:
        """Creates an account and signs it in, unless registration is closed."""
        if not appconfig.flag("features", "registrationOpen"):
            raise PermissionDenied("Registration is closed.")
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(AnonymousView):
    throttle_classes = (LoginIpThrottle, LoginEmailThrottle)

    @extend_schema(request=LoginSerializer, responses={200: UserSerializer})
    def post(self, request: Request) -> Response:
        """Starts a session."""
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        # Emails match without regard to case; `authenticate` wants the stored spelling.
        known = User.objects.filter(email__iexact=email).values_list("email", flat=True).first()
        user = authenticate(
            request, email=known or email, password=serializer.validated_data["password"]
        )
        if user is None:
            raise AuthenticationFailed("The email or the password is wrong.")
        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        """Ends the session."""
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    @extend_schema(responses={200: UserSerializer})
    def get(self, request: Request) -> Response:
        """The signed-in user. Sets the CSRF cookie either way, also on a 401."""
        return Response(UserSerializer(request.user).data)


class PasswordResetView(AnonymousView):
    @extend_schema(request=PasswordResetSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        """Emails a reset link. Answers the same whether or not the account exists."""
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is not None and user.has_usable_password():
            send_reset_email(user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(AnonymousView):
    @extend_schema(request=PasswordResetConfirmSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        """Sets a new password with the uid and token from the reset link."""
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = serializer.validated_data
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(data["uid"])))
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            user = None
        if user is None or not default_token_generator.check_token(user, data["token"]):
            raise serializers.ValidationError(
                {"token": ["This reset link is not valid or has expired."]}
            )
        check_password(data["password"], user)
        user.set_password(data["password"])
        user.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)
