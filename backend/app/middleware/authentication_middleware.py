import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
from jose import JWTError
from datetime import datetime, timezone


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        from app.core.config import settings
        from app.security.jwt_tok import decode_token
        from fastapi.responses import JSONResponse

        # Inject request ID for log correlation
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id

        # Skip public routes
        if request.method == "OPTIONS":
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            return response

        if request.url.path in settings.EXCLUDED_PATHS or request.url.path.startswith("/auth/esign/"):
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            return response

        # Extract access token from header or cookie
        auth_header = request.headers.get("Authorization")
        token = (
            auth_header.split(" ")[1]
            if auth_header and auth_header.startswith("Bearer ")
            else request.cookies.get("access_token")
        )

        payload = None
        new_tokens = None

        if token:
            try:
                payload = decode_token(token)  # sync — no await needed

                # Proactive rotation: rotate if token expires in < TOKEN_ROTATE_THRESHOLD seconds
                exp = payload.get("exp")
                if exp:
                    exp_time = datetime.fromtimestamp(exp, tz=timezone.utc)
                    now = datetime.now(tz=timezone.utc)
                    if (exp_time - now).total_seconds() < settings.TOKEN_ROTATE_THRESHOLD:
                        payload = None  # Trigger rotation below

                if payload:
                    # Verify active status — Redis cache first, then DB
                    from app.core.cache import cache_manager
                    user_code = payload.get("user_code")
                    if user_code:
                        cache_key = f"user:{str(user_code).lower()}"
                        cached_user = await cache_manager.get(cache_key)

                        if cached_user:
                            if not cached_user.get("is_active"):
                                return JSONResponse(
                                    status_code=403,
                                    content={"detail": "Account deactivated"},
                                    headers={"X-Request-ID": request_id},
                                )
                        else:
                            # Cache miss: verify in DB once and repopulate cache
                            from app.core.database_initialization import AsyncSessionLocal
                            from sqlalchemy import select
                            from app.models.model import User
                            async with AsyncSessionLocal() as session:
                                res = await session.execute(
                                    select(User).where(User.user_code == user_code)
                                )
                                db_user = res.scalar_one_or_none()
                                if db_user:
                                    if not db_user.is_active:
                                        return JSONResponse(
                                            status_code=403,
                                            content={"detail": "Account deactivated"},
                                            headers={"X-Request-ID": request_id},
                                        )
                                    await cache_manager.set(
                                        cache_key,
                                        {"is_active": db_user.is_active, "role": db_user.role},
                                        expire=3600,
                                    )

                    request.state.user = payload

            except JWTError:
                payload = None  # Expired or invalid — try rotation below

        # If no valid payload, attempt refresh-token rotation
        if not payload:
            refresh_token = request.cookies.get("refresh_token")
            if refresh_token:
                try:
                    from app.services.authentication_service import AuthenticationService
                    new_tokens = await AuthenticationService.rotate_token(refresh_token)
                    payload = new_tokens["payload"]
                    request.state.user = payload
                except Exception:
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "Session expired"},
                        headers={"X-Request-ID": request_id},
                    )
            else:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Missing or invalid token"},
                    headers={"X-Request-ID": request_id},
                )

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id

        # Attach rotated tokens to response if rotation occurred
        if new_tokens:
            self._set_token_cookies(response, new_tokens["access_token"], new_tokens["refresh_token"])
            response.headers["x-new-token"] = new_tokens["access_token"]

        return response

    def _set_token_cookies(self, response, access_token: str, refresh_token: str):
        from app.core.config import settings
        is_production = not settings.FRONTEND_URL.startswith("http://localhost")
        cookie_secure = is_production
        cookie_samesite = "none" if is_production else "lax"

        response.set_cookie(
            "access_token", access_token,
            httponly=True, secure=cookie_secure, samesite=cookie_samesite,
        )
        response.set_cookie(
            "refresh_token", refresh_token,
            httponly=True, secure=cookie_secure, samesite=cookie_samesite,
        )
        # Expose x-new-token for frontend consumption
        existing_expose = response.headers.get("Access-Control-Expose-Headers", "")
        if "x-new-token" not in existing_expose.lower():
            response.headers["Access-Control-Expose-Headers"] = (
                f"{existing_expose}, x-new-token" if existing_expose else "x-new-token"
            )
