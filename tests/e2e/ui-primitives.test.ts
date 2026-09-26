import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('The user menu works from the keyboard', async ({
	page,
	navigate,
	login,
}) => {
	const user = await login()
	await navigate('/collection')

	const trigger = page.getByRole('link', { name: /user menu/i })
	await trigger.focus()
	await page.keyboard.press('Enter')

	const menu = page.getByRole('menu')
	await expect(menu).toBeVisible()
	await expect(page.getByRole('menuitem', { name: /profile/i })).toBeFocused()

	await page.keyboard.press('ArrowDown')
	await expect(
		page.getByRole('menuitem', { name: /collection/i }),
	).toBeFocused()

	await page.keyboard.press('Escape')
	await expect(menu).toBeHidden()
	await expect(trigger).toBeFocused()

	// items are links: choosing one navigates
	await page.keyboard.press('Enter')
	await page.getByRole('menuitem', { name: /profile/i }).press('Enter')
	await expect(page).toHaveURL(`/users/${user.username}`)
})

test('The disconnect tooltip opens on hover and focus', async ({
	page,
	navigate,
	login,
	prepareGitHubUser,
}) => {
	const user = await login()
	const ghUser = await prepareGitHubUser()
	await prisma.connection.create({
		data: {
			providerName: 'github',
			providerId: String(ghUser.profile.id),
			userId: user.id,
		},
	})
	await navigate('/settings/profile/connections')

	const disconnect = page.getByRole('button', { name: /disconnect/i })
	const tooltip = page.getByText('Disconnect this account')

	await disconnect.hover()
	await expect(tooltip).toBeVisible()

	await page.mouse.move(0, 0)
	await expect(tooltip).toBeHidden()

	await disconnect.focus()
	await expect(tooltip).toBeVisible()
})
