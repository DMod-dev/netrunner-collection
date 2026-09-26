import AxeBuilder from '@axe-core/playwright'
import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test as base } from '#tests/playwright-utils.ts'

const SITE_TITLE_SUFFIX = '| Netrunner Collection'

const test = base.extend<{
	/** Logs in as a new user who also has the admin role. */
	loginAsAdmin(): Promise<{ id: string; username: string }>
}>({
	loginAsAdmin: async ({ login }, use) => {
		await use(async () => {
			const user = await login()
			await prisma.user.update({
				where: { id: user.id },
				data: { roles: { connect: { name: 'admin' } } },
			})
			return user
		})
	},
})

/**
 * Like the `navigate` fixture, but takes any path, so it works for pages the
 * route types don't know about yet. Waits for hydration before returning.
 */
async function goto(page: Page, path: string) {
	const response = await page.goto(path)
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
	return response
}

async function expectSiteTitle(page: Page) {
	await expect
		.poll(() => page.title())
		.toMatch(new RegExp(`${escapeRegExp(SITE_TITLE_SUFFIX)}$`))
}

function escapeRegExp(text: string) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('the landing page is titled with the site name', async ({ page }) => {
	await goto(page, '/')
	await expect(page).toHaveTitle('Netrunner Collection')
})

test('logged-out pages have a site title', async ({ page }) => {
	for (const path of ['/about', '/support', '/privacy', '/tos']) {
		await test.step(path, async () => {
			await goto(page, path)
			await expectSiteTitle(page)
		})
	}
})

test('logged-in pages have a site title', async ({ page, login }) => {
	await login()
	for (const path of ['/settings/profile', '/settings/profile/passkeys']) {
		await test.step(path, async () => {
			await goto(page, path)
			await expectSiteTitle(page)
		})
	}
})

test('admin pages have a site title', async ({ page, loginAsAdmin }) => {
	await loginAsAdmin()
	await goto(page, '/admin/cache')
	await expectSiteTitle(page)
})

test('footer links lead to pages with a heading', async ({ page }) => {
	for (const name of ['About', 'Support', 'Privacy', 'Terms']) {
		await test.step(name, async () => {
			await goto(page, '/')
			const footerNav = page
				.getByRole('contentinfo')
				.getByRole('navigation', { name: 'Footer' })
			const link = footerNav.getByRole('link', { name, exact: true })
			const href = await link.getAttribute('href')
			expect(href, `${name} link has an href`).toBeTruthy()

			const response = await page.request.get(href!)
			expect(response.ok(), `${href} responds with ${response.status()}`).toBe(
				true,
			)

			await link.click()
			await expect(page).toHaveURL(href!)
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
		})
	}
})

test('the user menu lists the account pages', async ({
	page,
	navigate,
	login,
}) => {
	await login()
	await navigate('/')
	await page.getByRole('link', { name: 'User menu' }).click()

	const menu = page.getByRole('menu')
	for (const name of ['Profile', 'Collection', 'Settings', 'Logout']) {
		await expect(menu.getByRole('menuitem', { name })).toBeVisible()
	}
	await expect(
		menu.getByRole('menuitem', { name: 'Card data sync' }),
	).toHaveCount(0)
	await expect(menu.getByRole('menuitem', { name: 'Cache' })).toHaveCount(0)
})

test('the user menu lists admin pages for admins', async ({
	page,
	navigate,
	loginAsAdmin,
}) => {
	await loginAsAdmin()
	await navigate('/')
	await page.getByRole('link', { name: 'User menu' }).click()

	const menu = page.getByRole('menu')
	for (const name of [
		'Profile',
		'Collection',
		'Settings',
		'Card data sync',
		'Cache',
		'Logout',
	]) {
		await expect(menu.getByRole('menuitem', { name })).toBeVisible()
	}
})

test('signup renders without React key warnings', async ({
	page,
	navigate,
}) => {
	const keyWarnings: string[] = []
	page.on('console', (message) => {
		const text = message.text()
		if (text.includes('unique "key"')) keyWarnings.push(text)
	})

	await navigate('/signup')
	await expect(
		page.getByRole('heading', { level: 1, name: 'Create your account' }),
	).toBeVisible()

	expect(keyWarnings).toEqual([])
})

test('buttons and selects have accessible names', async ({
	page,
	loginAsAdmin,
}) => {
	await loginAsAdmin()
	for (const path of ['/settings/profile/connections', '/admin/cache']) {
		await test.step(path, async () => {
			await goto(page, path)
			const results = await new AxeBuilder({ page })
				.withRules(['button-name', 'select-name'])
				.analyze()
			expect(
				results.violations.map((violation) => ({
					id: violation.id,
					targets: violation.nodes.map((node) => node.target),
				})),
			).toEqual([])
		})
	}
})
