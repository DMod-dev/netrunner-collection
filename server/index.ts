import { styleText } from 'node:util'
import { helmet } from '@nichtsam/helmet/node-http'
import * as Sentry from '@sentry/react-router'
import { ip as ipAddress } from 'address'
import closeWithGrace from 'close-with-grace'
import compression from 'compression'
import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import getPort, { portNumbers } from 'get-port'
import morgan from 'morgan'
import { formatUrlForLog } from '../app/utils/log-redaction.ts'
import { createHostAllowlist } from './allowed-hosts.ts'
import { createBodyLimit } from './body-limit.ts'

const MODE = process.env.NODE_ENV ?? 'development'
const IS_PROD = MODE === 'production'
const IS_DEV = MODE === 'development'
const ALLOW_INDEXING = process.env.ALLOW_INDEXING !== 'false'
const SENTRY_ENABLED = IS_PROD && process.env.SENTRY_DSN
const BUILD_PATH = '../build/server/index.js'
// Nothing in the app uses these; deny them so injected content can't either.
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'

if (SENTRY_ENABLED) {
	void import('./utils/monitoring.ts').then(({ init }) => init())
}

const app = express()

// Only `Host` is trustworthy behind Fly (see ./allowed-hosts.ts).
const getHost = (req: { get: (key: string) => string | undefined }) =>
	req.get('host') ?? ''

// fly is our proxy
app.set('trust proxy', true)

// Pin the host. Fly passes a client-supplied X-Forwarded-Host straight through,
// and Express (`req.hostname`, so React Router's `request.url` too) would trust
// it because of `trust proxy`. Strip it before anything else can read it, and in
// production refuse requests whose Host is not one of ours so a spoofed host
// can never end up in a redirect, the sitemap, or an emailed link.
const isAllowedHost = createHostAllowlist({
	appOrigin: process.env.APP_ORIGIN,
	flyAppName: process.env.FLY_APP_NAME,
})
app.use((req, res, next) => {
	delete req.headers['x-forwarded-host']
	if (!IS_PROD) return next()
	// Fly's health probes hit the machine directly; the check no longer looks at
	// the host, so let it through whatever Host the probe sends.
	if (req.path === '/resources/healthcheck') return next()
	if (isAllowedHost(req.get('host'))) return next()
	res.status(421).type('text/plain').send('Misdirected Request')
})

// Every action buffers its whole body with request.formData() before it can
// validate anything, so cap bodies before any of that code runs.
app.use(createBodyLimit())

// ensure HTTPS only (X-Forwarded-Proto comes from Fly)
app.use((req, res, next) => {
	if (req.method !== 'GET') return next()
	const proto = req.get('X-Forwarded-Proto')
	const host = getHost(req)
	if (proto === 'http') {
		res.set('X-Forwarded-Proto', 'https')
		res.redirect(`https://${host}${req.originalUrl}`)
		return
	}
	next()
})

// one canonical address: www.example.com -> example.com
app.use((req, res, next) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') return next()
	const host = getHost(req)
	if (host.startsWith('www.')) {
		res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`)
		return
	}
	next()
})

// no ending slashes for SEO reasons
// https://github.com/epicweb-dev/epic-stack/discussions/108
app.get(/.*/, (req, res, next) => {
	if (req.path.endsWith('/') && req.path.length > 1) {
		const query = req.url.slice(req.path.length)
		const safepath = req.path.slice(0, -1).replace(/\/+/g, '/')
		res.redirect(302, safepath + query)
	} else {
		next()
	}
})

app.use(compression())

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable('x-powered-by')

app.use((_, res, next) => {
	// Set by hand below: helmet's typings misspell this policy's name.
	helmet(res, { general: { referrerPolicy: false } })
	// Same-origin requests keep the full referrer (getReferrerRoute relies on
	// it for redirectTo); other origins only ever see our origin.
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
	res.setHeader('Permissions-Policy', PERMISSIONS_POLICY)
	next()
})

app.get([/^\/img\/.*/, /^\/favicons\/.*/], (_req, res) => {
	// if we made it past the express.static for these, then we're missing something.
	// So we'll just send a 404 and won't bother calling other middleware.
	return res.status(404).send('Not found')
})

// Verification links are GETs carrying the one-time code and the user's
// email; keep those out of the logs (Sentry gets the same treatment in
// ./utils/monitoring.ts).
morgan.token('url', (req) => formatUrlForLog(req.url ?? ''))
app.use(
	morgan('tiny', {
		skip: (req, res) =>
			res.statusCode === 200 &&
			(req.url?.startsWith('/resources/images') ||
				req.url?.startsWith('/resources/healthcheck')),
	}),
)

// When running tests or running in development, we want to effectively disable
// rate limiting because playwright tests are very fast and we don't want to
// have to wait for the rate limit to reset between tests.
const maxMultiple =
	!IS_PROD || process.env.PLAYWRIGHT_TEST_BASE_URL ? 10_000 : 1
const rateLimitDefault = {
	windowMs: 60 * 1000,
	limit: 1000 * maxMultiple,
	standardHeaders: true,
	legacyHeaders: false,
	validate: { trustProxy: false },
	// Malicious users can spoof their IP address which means we should not default
	// to trusting req.ip when hosted on Fly.io. However, users cannot spoof Fly-Client-Ip.
	// When sitting behind a CDN such as cloudflare, replace fly-client-ip with the CDN
	// specific header such as cf-connecting-ip
	keyGenerator: (req: express.Request) => {
		const ip = req.ip ?? req.socket?.remoteAddress
		return req.get('fly-client-ip') ?? ipKeyGenerator(ip ?? '0.0.0.0')
	},
}

const strongestRateLimit = rateLimit({
	...rateLimitDefault,
	windowMs: 60 * 1000,
	limit: 10 * maxMultiple,
})

const strongRateLimit = rateLimit({
	...rateLimitDefault,
	windowMs: 60 * 1000,
	limit: 100 * maxMultiple,
})

const generalRateLimit = rateLimit(rateLimitDefault)

// Image resizing is the most CPU- and memory-hungry thing an anonymous request
// can trigger on the single 512 MB machine, so it gets its own, tighter bucket.
// Cache hits count too, but even the user directory only shows a few dozen
// avatars per page.
const imageRateLimit = rateLimit({
	...rateLimitDefault,
	windowMs: 60 * 1000,
	limit: 300 * maxMultiple,
})

// Endpoints that do real work per request: a collection import parses up to
// 20k rows and writes them in one transaction, a deck check calls NetrunnerDB
// and walks the user's collection, an export serialises all of it. A person
// does these a few times a day; a script hitting them 100 times a minute is
// the cheapest way to pin the CPU.
const expensiveRateLimit = rateLimit({
	...rateLimitDefault,
	windowMs: 60 * 1000,
	limit: 10 * maxMultiple,
})
const expensiveRequests: Array<{ method: string; path: string }> = [
	{ method: 'POST', path: '/collection/import-export' },
	{ method: 'POST', path: '/collection/deck-check' },
	{ method: 'GET', path: '/resources/collection-export' },
]

app.use((req, res, next) => {
	if (req.path.startsWith('/resources/images')) {
		return imageRateLimit(req, res, next)
	}

	// Client-side navigations and fetchers hit `<route>.data`; treat those
	// the same as the document request.
	const routePath = req.path.replace(/\.data$/, '')
	if (
		expensiveRequests.some(
			(r) => r.method === req.method && r.path === routePath,
		)
	) {
		return expensiveRateLimit(req, res, next)
	}

	const strongPaths = [
		'/login',
		'/signup',
		'/verify',
		'/admin',
		'/onboarding',
		'/forgot-password',
		'/reset-password',
		'/settings/profile',
		'/resources/login',
		'/resources/verify',
	]
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		if (strongPaths.some((p) => req.path.includes(p))) {
			return strongestRateLimit(req, res, next)
		}
		return strongRateLimit(req, res, next)
	}

	// the verify route is a special case because it's a GET route that
	// can have a token in the query string
	if (req.path.includes('/verify')) {
		return strongestRateLimit(req, res, next)
	}

	return generalRateLimit(req, res, next)
})

if (!ALLOW_INDEXING) {
	app.use((_, res, next) => {
		res.set('X-Robots-Tag', 'noindex, nofollow')
		next()
	})
}

if (IS_DEV) {
	console.log('Starting development server')
	const viteDevServer = await import('vite').then((vite) =>
		vite.createServer({
			server: { middlewareMode: true },
			// We tell Vite we are running a custom app instead of
			// the SPA default so it doesn't run HTML middleware
			appType: 'custom',
		}),
	)
	app.use(viteDevServer.middlewares)
	app.use(async (req, res, next) => {
		try {
			const source = await viteDevServer.ssrLoadModule('./server/app.ts')
			return await source.app(req, res, next)
		} catch (error) {
			if (typeof error === 'object' && error instanceof Error) {
				viteDevServer.ssrFixStacktrace(error)
			}
			next(error)
		}
	})
} else {
	console.log('Starting production server')
	// React Router fingerprints its assets so we can cache forever.
	app.use(
		'/assets',
		express.static('build/client/assets', {
			immutable: true,
			maxAge: '1y',
			fallthrough: false,
		}),
	)
	// Everything else (like favicon.ico) is cached for an hour. You may want to be
	// more aggressive with this caching.
	app.use(express.static('build/client', { maxAge: '1h' }))
	app.use(await import(BUILD_PATH).then((mod) => mod.app))
}

const desiredPort = Number(process.env.PORT || 3000)
const portToUse = await getPort({
	port: portNumbers(desiredPort, desiredPort + 100),
})
const portAvailable = desiredPort === portToUse
if (!portAvailable && !IS_DEV) {
	console.log(`⚠️ Port ${desiredPort} is not available.`)
	process.exit(1)
}

const server = app.listen(portToUse, () => {
	if (!portAvailable) {
		console.warn(
			styleText(
				'yellow',
				`⚠️  Port ${desiredPort} is not available, using ${portToUse} instead.`,
			),
		)
	}
	console.log(`🚀  We have liftoff!`)
	const localUrl = `http://localhost:${portToUse}`
	let lanUrl: string | null = null
	const localIp = ipAddress() ?? 'Unknown'
	// Check if the address is a private ip
	// https://en.wikipedia.org/wiki/Private_network#Private_IPv4_address_spaces
	// https://github.com/facebook/create-react-app/blob/d960b9e38c062584ff6cfb1a70e1512509a966e7/packages/react-dev-utils/WebpackDevServerUtils.js#LL48C9-L54C10
	if (/^10[.]|^172[.](1[6-9]|2[0-9]|3[0-1])[.]|^192[.]168[.]/.test(localIp)) {
		lanUrl = `http://${localIp}:${portToUse}`
	}

	console.log(
		`
${styleText('bold', 'Local:')}            ${styleText('cyan', localUrl)}
${lanUrl ? `${styleText('bold', 'On Your Network:')}  ${styleText('cyan', lanUrl)}` : ''}
${styleText('bold', 'Press Ctrl+C to stop')}
		`.trim(),
	)
})

closeWithGrace(async ({ err }) => {
	await new Promise((resolve, reject) => {
		server.close((e) => (e ? reject(e) : resolve('ok')))
	})
	if (err) {
		console.error(styleText('red', String(err)))
		console.error(styleText('red', String(err.stack)))
		if (SENTRY_ENABLED) {
			Sentry.captureException(err)
			await Sentry.flush(500)
		}
	}
})
