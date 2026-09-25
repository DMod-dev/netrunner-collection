import { expect, test } from '#tests/playwright-utils.ts'

test('pages send an enforced CSP and the privacy headers', async ({ page }) => {
	const response = await page.request.get('/')
	const headers = response.headers()

	expect(headers['content-security-policy']).toContain(
		"script-src 'strict-dynamic'",
	)
	expect(headers['content-security-policy']).not.toContain('https:')
	expect(headers['content-security-policy-report-only']).toBeUndefined()
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
	expect(headers['permissions-policy']).toBe(
		'camera=(), microphone=(), geolocation=()',
	)
	expect(headers['x-powered-by']).toBeUndefined()
})

test('signed-in pages and data are never cached', async ({ page, login }) => {
	await login()

	for (const path of ['/collection', '/', '/settings/profile.data']) {
		const response = await page.request.get(path)
		expect(response.status(), path).toBe(200)
		expect(response.headers()['cache-control'], path).toBe('private, no-store')
	}
})

test('the theme switch only redirects within the site', async ({ page }) => {
	for (const redirectTo of ['https://evil.example', '//evil.example/path']) {
		const response = await page.request.post('/resources/theme-switch', {
			form: { theme: 'dark', redirectTo },
			maxRedirects: 0,
		})
		expect(response.status(), redirectTo).toBe(302)
		expect(response.headers().location, redirectTo).toBe('/')
	}

	const local = await page.request.post('/resources/theme-switch', {
		form: { theme: 'dark', redirectTo: '/about' },
		maxRedirects: 0,
	})
	expect(local.headers().location).toBe('/about')
})

test('the main pages load without CSP violations', async ({
	page,
	navigate,
	login,
}) => {
	const violations: Array<string> = []
	page.on('console', (message) => {
		if (message.text().includes('Content Security Policy')) {
			violations.push(`${page.url()}: ${message.text()}`)
		}
	})
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (event) => {
			console.error(
				`Content Security Policy: ${event.violatedDirective} blocked ${event.blockedURI}`,
			)
		})
	})

	// sonner (in the root layout) injects its <style> tag on every page
	await navigate('/')
	await navigate('/login')
	await login()
	for (const path of [
		'/collection',
		'/collection/sets',
		'/settings/profile',
	] as const) {
		await navigate(path)
		await page.waitForLoadState('networkidle')
	}
	expect(violations).toEqual([])
})
