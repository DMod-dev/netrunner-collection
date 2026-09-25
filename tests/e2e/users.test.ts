import { expect, test } from '#tests/playwright-utils.ts'

test('the user directory and profiles require signing in', async ({
	page,
	insertNewUser,
}) => {
	const user = await insertNewUser()

	for (const path of ['/users', `/users/${user.username}`]) {
		const response = await page.request.get(path, { maxRedirects: 0 })
		expect(response.status(), path).toBe(302)
		expect(response.headers().location, path).toBe(
			`/login?${new URLSearchParams({ redirectTo: path })}`,
		)
	}
})

test('signed-in users can browse the directory and profiles', async ({
	page,
	navigate,
	login,
}) => {
	const user = await login()

	await navigate('/users')
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/users/i)
	await page
		.getByRole('link', { name: `${user.name ?? user.username} profile` })
		.click()
	await expect(page).toHaveURL(`/users/${user.username}`)
	await expect(
		page.getByRole('heading', { name: user.name ?? user.username }),
	).toBeVisible()
})

test('the sitemap lists no signed-in pages', async ({ page }) => {
	const sitemap = await (await page.request.get('/sitemap.xml')).text()
	const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
		([, loc]) => new URL(loc!).pathname,
	)

	expect(locations).toContain('/about')
	for (const location of locations) {
		expect(location).not.toMatch(
			/^\/(users|collection|settings|onboarding)\b|\*/,
		)
	}
})
