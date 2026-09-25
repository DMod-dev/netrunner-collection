import { chromium, type FullConfig } from '@playwright/test'

// The dev server compiles lazily: the first SSR request loads the whole server
// build through Vite (~9-12 s cold), and the first page a browser opens
// transforms the client entry, the route modules and the pre-bundled deps. Left
// to the tests, all of that lands in the timeout of whichever tests happen to
// run first, all at once. Pay it once here instead, before any test starts.
// The production build (CI) has nothing to compile, so the config only runs
// this for `npm run dev`.
const pages = ['/', '/login', '/signup', '/forgot-password', '/does-not-exist']

export default async function warmUp(config: FullConfig) {
	const baseURL = config.projects[0]?.use.baseURL
	if (!baseURL) return
	const started = performance.now()

	// Playwright only waits for the port; the server answers once its first
	// request has loaded the app, so give that request all the time it needs.
	const ssrStarted = performance.now()
	await fetch(new URL('/', baseURL), { signal: AbortSignal.timeout(120_000) })
	const ssrMs = performance.now() - ssrStarted

	const browser = await chromium.launch()
	try {
		const page = await browser.newPage({ baseURL })
		for (const path of pages) {
			// networkidle so the route's client modules, and any reload Vite
			// triggers after optimizing a newly discovered dependency, finish here.
			await page.goto(path, { waitUntil: 'networkidle', timeout: 60_000 })
		}
	} finally {
		await browser.close()
	}

	console.log(
		`Warmed up the dev server in ${Math.round(performance.now() - started)} ms (first SSR request ${Math.round(ssrMs)} ms)`,
	)
}
