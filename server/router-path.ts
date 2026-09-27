/**
 * The path as React Router will match it. The router is case-insensitive,
 * decodes the path and ignores a trailing slash, so `/LOGIN`, `/%6cogin` and
 * `/login/` all reach the login action. Middleware that picks a rate limit by
 * path must compare against this, or those spellings get the lenient bucket.
 */
export function routerPath(path: string) {
	let decoded = path
	try {
		decoded = decodeURIComponent(path)
	} catch {
		// malformed escapes: the router can't match it either
	}
	return decoded.toLowerCase().replace(/\/+$/, '')
}
