# Security

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's
**Security → Report a vulnerability** on this repository (private vulnerability reporting), and
include what you found and how to reproduce it. You should hear back within a week.

请不要为安全问题创建公开 issue。请使用本仓库的 **Security → Report a vulnerability**（私密漏洞报告），
并说明发现的问题和复现方法。

## What dtsync stores

- A DingTalk CalDAV username and password. They grant read and write access to your DingTalk
  calendar and nothing else in DingTalk.
- A Google service account key. It can only access calendars you shared with the service
  account email.
- Sync history: event IDs, hashes, etags, and times. No titles, descriptions, or attendees.

Credentials saved on the setup page are encrypted (AES-256-GCM) with a key derived from
`ADMIN_PASSWORD` before they're stored. `ADMIN_PASSWORD` itself is a Worker secret or an
environment variable and is never written to storage by the Worker. If none is set, the
Node/Docker version generates one on first start and stores it in a file readable only by its
user.

Signing in to the setup page sends `ADMIN_PASSWORD` once. The browser then holds a session
cookie that scripts can't read (`HttpOnly`), that other sites can't send (`SameSite=Strict`),
and that the server only accepts on requests made by the page itself. A session is a signed
"valid until" token: nothing is stored server-side, it lasts 12 hours unless a page is open, and
changing `ADMIN_PASSWORD` ends every session. **Sign out** clears it from the browser.

Anyone who knows `ADMIN_PASSWORD` can change where your calendars sync to. Use a long one, and
change it if it leaks (you'll then need to re-enter your saved credentials).

## Revoking access

- DingTalk: generate a new CalDAV password in DingTalk; the old one stops working.
- Google: remove the service account email from your calendars' sharing settings, or delete the key in
  Google Cloud.
