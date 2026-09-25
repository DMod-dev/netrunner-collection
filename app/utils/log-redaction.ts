/**
 * Query parameters whose values must never reach a log line or an error
 * report. Verification links (`/verify?type=…&target=…&code=…`) are GETs, so
 * without this the one-time code and the user's email address would land in
 * Fly's logs (and Sentry's request data) for every emailed link that is
 * clicked.
 */
export const SENSITIVE_QUERY_PARAMS = ['code', 'target', 'redirectTo'] as const

const REDACTED = '[redacted]'

const sensitiveParamPattern = new RegExp(
	`([?&](?:${SENSITIVE_QUERY_PARAMS.join('|')})=)[^&#]*`,
	'g',
)

/**
 * Replace the values of sensitive query parameters in a URL or path with
 * `[redacted]`. Works on the raw (still percent-encoded) string so an encoded
 * `&` inside a value can't smuggle part of it past the redaction. Everything
 * else is returned untouched.
 */
export function redactUrl(url: string): string {
	return url.replace(sensitiveParamPattern, `$1${REDACTED}`)
}

/**
 * A URL for a log line: sensitive values redacted first, then the rest
 * percent-decoded for readability (falling back to the encoded form if it
 * isn't valid UTF-8).
 */
export function formatUrlForLog(url: string): string {
	const redacted = redactUrl(url)
	try {
		return decodeURIComponent(redacted)
	} catch {
		return redacted
	}
}

/**
 * Sentry's request data can carry the URL in `url` and again in
 * `query_string`; scrub both in place. Safe to call on any event shape.
 */
export function redactSentryRequest<
	Event extends {
		request?: { url?: string; query_string?: unknown } | null
	},
>(event: Event): Event {
	const request = event.request
	if (!request) return event
	if (typeof request.url === 'string') request.url = redactUrl(request.url)
	if (typeof request.query_string === 'string') {
		request.query_string = redactUrl(`?${request.query_string}`).slice(1)
	} else if (request.query_string && typeof request.query_string === 'object') {
		const query = request.query_string as Record<string, unknown>
		for (const param of SENSITIVE_QUERY_PARAMS) {
			if (param in query) query[param] = REDACTED
		}
	}
	return event
}
