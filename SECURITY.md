# TechRoom security notes

Implemented hardening:
- Admin password is never stored in browser storage and is never sent with product requests.
- Admin login creates an 8-hour signed HttpOnly + Secure + SameSite=Strict session cookie.
- Constant-time password/signature comparison.
- Brute-force throttling on admin login and rate limiting on mutations.
- Server-side validation and field length/range limits.
- Request body size limits.
- Parameterized SQL and numeric product ID validation.
- Database/internal error details are not exposed to clients.
- Security headers: CSP, HSTS, frame denial, nosniff, referrer policy and permissions policy.
- Admin/API responses with sensitive state are non-cacheable.

Deployment requirements:
- Set ADMIN_PASSWORD to a unique password of at least 12 characters (prefer 16+ random characters).
- Set ADMIN_SESSION_SECRET to at least 32 random characters. If omitted, the app derives a signing key from ADMIN_PASSWORD for backwards compatibility.
- Keep DATABASE_URL only in Render environment variables; never commit it.
- Rotate ADMIN_PASSWORD immediately if it was ever committed, shared in chat, screenshots, or logs.

Limitations:
- In-memory rate limiting is per service instance. For multi-instance production deployments, use a shared Redis/Key Value rate limiter.
- This project has not had a professional third-party penetration test.
