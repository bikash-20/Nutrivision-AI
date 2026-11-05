# Authentication API

NutriVision AI uses **Google Identity Services (GIS)** OAuth 2.0 with cryptographic verification of Google ID tokens and issuance of secure session JWTs.

---

## `POST /api/auth/google`

Authenticates a user via Google OAuth 2.0 Identity Services.

### Flow
1. The user clicks **Continue with Google** on the web client.
2. The Google GIS SDK returns a signed OpenID Connect ID token (`credential`).
3. The client sends the ID token to `POST /api/auth/google`.
4. The backend:
   - Calls Google's tokeninfo endpoint to verify the token; when `GOOGLE_CLIENT_ID` is configured, it also checks the token audience.
   - Validates that the token signature is authentic, not expired (`exp`), and issued for `GOOGLE_CLIENT_ID` (`aud`).
   - Extracts `email`, `name`, and `picture`.
   - Determines the role: assigns `admin` if the email appears in the `ADMIN_EMAILS` environment variable, otherwise `user`.
   - Provisions or retrieves the user's isolated partition in PostgreSQL (`nv_users`).
   - Generates a signed HS256 session JWT valid for 7 days.

### Request

```http
POST /api/auth/google HTTP/1.1
Content-Type: application/json

{
  "credential": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...<Google ID Token>..."
}
```

**Schema:** `GoogleAuthRequest`.

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...<Session JWT>...",
  "user": {
    "email": "user@gmail.com",
    "name": "Jane Doe",
    "avatarUrl": "https://lh3.googleusercontent.com/...",
    "role": "user",
    "joinedDate": "2026-10-31T03:00:00Z",
    "lastActive": "2026-10-31T03:00:00Z"
  }
}
```

**Schema:** `GoogleAuthResponse`.

### Errors

| Status | Cause |
|---|---|
| `400 Bad Request` | Missing or invalid ID token structure |
| `401 Unauthorized` | Invalid Google signature, expired token, or audience mismatch |
| `500 Internal Error` | Missing `GOOGLE_CLIENT_ID` or `JWT_SECRET` on server |

---

## `GET /api/auth/me`

Retrieves the authenticated user's current session and verified role.

### Request

```http
GET /api/auth/me HTTP/1.1
Authorization: Bearer <session-jwt>
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "email": "bikashtalukder040@gmail.com",
  "name": "Bikash Talukder",
  "avatarUrl": "https://lh3.googleusercontent.com/a/...",
  "role": "admin",
  "joinedDate": "2026-10-30T18:00:00Z",
  "lastActive": "2026-10-31T04:00:00Z"
}
```

---

## `POST /api/auth/logout`

Clears server-side user activity markers. The client removes the token from `localStorage['nv_auth']`.

### Request

```http
POST /api/auth/logout HTTP/1.1
Authorization: Bearer <session-jwt>
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok"
}
```
