/**
 * Which `Host` values this server answers to.
 *
 * Fly preserves the client's `Host` header but forwards a client-supplied
 * `X-Forwarded-Host` untouched, so `Host` is the only trustworthy one, and even
 * that is validated here so a request for an unexpected host can never steer a
 * redirect or an absolute URL. Anything else gets `421 Misdirected Request`.
 */
export function createHostAllowlist({
	appOrigin,
	flyAppName,
}: {
	appOrigin: string | undefined
	flyAppName: string | undefined
}) {
	const exact = new Set<string>()
	if (appOrigin) {
		const { hostname } = new URL(appOrigin)
		exact.add(hostname)
		exact.add(`www.${hostname}`)
	}
	if (flyAppName) exact.add(`${flyAppName}.fly.dev`)

	return function isAllowedHost(hostHeader: string | undefined) {
		if (!hostHeader) return false
		const hostname = stripPort(hostHeader).toLowerCase()
		if (exact.has(hostname)) return true
		// Loopback: local runs, docker, and health probes on the machine itself.
		if (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '[::1]'
		) {
			return true
		}
		// Fly's private 6PN network: litefs-js instance-to-instance calls use
		// `<instance>.vm.<app>.internal` and are only reachable from inside the org.
		if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.internal$/.test(hostname)) return true
		return false
	}
}

function stripPort(host: string) {
	// `[::1]:8081` keeps the brackets; `example.com:443` loses the port.
	const bracketed = host.match(/^(\[[^\]]*\])(?::\d+)?$/)
	if (bracketed?.[1]) return bracketed[1]
	return host.replace(/:\d+$/, '')
}
