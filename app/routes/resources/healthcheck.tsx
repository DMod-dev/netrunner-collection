// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { prisma } from '#app/utils/db.server.ts'

export async function loader() {
	try {
		// If we can connect to the database and make a simple query, we're good.
		// The fact that this request reached us already proves the HTTP layer is
		// up, so we deliberately do not fetch ourselves: an earlier self-fetch
		// used the request's Host header, which made this route a server-side
		// request oracle for any host an attacker put in X-Forwarded-Host.
		// Prefer SELECT 1 over User.count(): count() was producing Slow DB Query
		// Sentry insights on the tiny Fly demo VM without indicating app issues.
		await prisma.$queryRaw`SELECT 1`
		return new Response('OK')
	} catch (error: unknown) {
		console.log('healthcheck ❌', { error })
		return new Response('ERROR', { status: 500 })
	}
}
