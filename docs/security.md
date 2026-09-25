# Security

The Epic Stack has several security measures in place to protect your users and
yourself. This (incomplete) document, explains some of the security measures
that are in place and how to use them.

## Content Security Policy

The Epic Stack uses a strict
[Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP).
This means that only resources from trusted sources are allowed to be loaded.
However, by default, the CSP is set to `report-only` which means that the
browser will report violations of the CSP without actually blocking the
resource.

This is to prevent new users of the Epic Stack from being blocked or surprised
by the CSP by default. However, it is recommended to enable the CSP in
`server/index.ts` by removing the `reportOnly: true` option.

## Canonical origin and the Host header

Fly preserves the client's `Host` header but forwards a client-supplied
`X-Forwarded-Host` untouched. Anything that builds an absolute URL from request
headers (password-reset and onboarding emails, the sitemap, passkey `rpID`)
would therefore let an attacker choose the host in a link the real site emails
to a victim. Two things prevent that:

- `getDomainUrl` in `app/utils/misc.tsx` returns `APP_ORIGIN` whenever it is set
  (it is required in production) and only falls back to `Host` in development.
  It never reads `X-Forwarded-Host`.
- The first middleware in `server/index.ts` deletes `X-Forwarded-Host` from the
  request and, in production, answers `421 Misdirected Request` for any `Host`
  that is not `APP_ORIGIN`, its `www.` variant, `<app>.fly.dev`, loopback, or
  Fly's private `*.internal` names (see `server/allowed-hosts.ts`).

The health check at `/resources/healthcheck` only queries the database; it does
not fetch the site itself, so it can't be used to probe other hosts.

## Image proxy

`/resources/images` only serves two kinds of sources: profile photos by
`objectKey` (validated against the exact shape `uploadProfileImage` produces)
and a short allowlist of static files under `public/img` and `public/favicons`.
Widths and heights are snapped to a fixed set of sizes, the source is checked
with `sharp` metadata before any decoding, and every failure turns into a 4xx or
5xx response instead of an uncaught stream error that would take the process
down. Profile photos are re-encoded to WebP (metadata stripped, at most
1024×1024) when they are uploaded, so a non-image or a decompression bomb never
reaches storage. The route also has its own, tighter rate-limit bucket.

## Fly's Internal Network

The Epic Stack uses [Fly](https://fly.io) for hosting. Fly has an internal
network that allows you to connect services to each other without exposing them
to the public internet. Only services within your organization have access to
this network, and only accounts in your organization have access as well.

When running multiple instances of the Epic Stack, your instances communicate
with each other over this internal network. Most of this happens behind the
scenes with the consul service that Fly manages for us.

We also have an endpoint that allows instances to connect to each other to
update the cache in the primary region. This uses internal URLs for that
communication (via [`litefs-js`](https://github.com/fly-apps/litefs-js)), but as
an added layer of security it uses a shared secret to validate the requests.

> This could be changed if there's a way to determine if a request is coming
> from the internal network. But I haven't found a way to do that yet. PRs
> welcome!

Outside of this, the Epic Stack does not access other first-party services or
databases.

## Secrets

The currently recommended policy for managing secrets is to place them in a
`.env` file in the root of the application (which is `.gitignore`d). There is a
`.env.example` which can be used as a template for this file (and if you do not
need to actually connect to real services, this can be used as
`cp .env.example .env`).

These secrets need to also be set on Fly using the `fly secrets` command.

There are significant limitations to this approach and will probably be improved
in the future.

## [Cross-Site Scripting (XSS)](https://developer.mozilla.org/en-US/docs/Glossary/Cross-site_scripting)

React has built-in support for XSS protection. It does this by escaping all
values by default. This means that if you want to render HTML, you need to use
the `dangerouslySetInnerHTML` prop. This is a good thing, but it does mean that
you need to be careful when rendering HTML. Never pass anything that is
user-generated to this prop.

## [Cross-Site Request Forgery (CSRF)](https://forms.epicweb.dev/07)

The Epic Stack has built-in support to prevent CSRF attacks. We use the
[`remix-utils`](https://github.com/sergiodxa/remix-utils)
[CSRF-related utilities](https://github.com/sergiodxa/remix-utils#csrf) to do
this.

## [Honeypot](https://forms.epicweb.dev/06)

The Epic Stack has built-in support for honeypot fields. We use the
[`remix-utils`](https://github.com/sergiodxa/remix-utils)
[honeypot-related utilities](https://github.com/sergiodxa/remix-utils#form-honeypot)
to do this.

## Rate Limiting

The Epic Stack uses a rate limiter to prevent abuse of the API. This is
configured in the `server/index.ts` file and can be changed as needed. By
default it uses [`express-rate-limit`](https://npm.im/express-rate-limit) with
the in-memory store. There are trade-offs with this simpler approach, but it
should be relatively simple to externalize the store into Redis as that's a
built-in feature to express-rate-limit.
