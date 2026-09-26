import { randomUUID } from 'node:crypto'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test as base } from '#tests/playwright-utils.ts'

/**
 * One card with a single printing, plus cleanup for it and for any extra users
 * the test signs in as (the `login` fixture only removes the last one).
 */
const test = base.extend<{
	seedCard(): Promise<{ title: string; printingId: string }>
	cleanUpUser(userId: string): void
}>({
	seedCard: async ({}, use) => {
		const id = randomUUID().slice(0, 8)
		await use(async () => {
			const title = `Zs${id} Shared Card`
			await prisma.faction.create({
				data: { id, name: 'Test Faction', sideId: 'runner' },
			})
			await prisma.cardType.create({ data: { id, name: 'Test Type' } })
			await prisma.cardCycle.create({
				data: { id, name: `Test Cycle ${id}`, position: 0 },
			})
			await prisma.cardSet.create({
				data: {
					id,
					name: `Test Set ${id}`,
					position: 0,
					size: 1,
					setTypeId: 'core',
					cycleId: id,
				},
			})
			await prisma.card.create({
				data: {
					id,
					title,
					strippedTitle: title,
					sideId: 'runner',
					deckLimit: 3,
					factionId: id,
					typeId: id,
					printings: {
						create: { id, position: 1, quantity: 1, setId: id },
					},
				},
			})
			return { title, printingId: id }
		})
		const printing = { setId: id }
		await prisma.collectionEntry.deleteMany({ where: { printing } })
		await prisma.printing.deleteMany({ where: printing })
		await prisma.card.deleteMany({ where: { factionId: id } })
		await prisma.cardSet.deleteMany({ where: { id } })
		await prisma.cardCycle.deleteMany({ where: { id } })
		await prisma.cardType.deleteMany({ where: { id } })
		await prisma.faction.deleteMany({ where: { id } })
	},
	cleanUpUser: async ({}, use) => {
		const ids: string[] = []
		await use((userId) => {
			ids.push(userId)
		})
		await prisma.user.deleteMany({ where: { id: { in: ids } } })
	},
})

test('share a collection, view it read-only, then remove the share', async ({
	page,
	navigate,
	login,
	insertNewUser,
	seedCard,
	cleanUpUser,
}) => {
	const viewer = await insertNewUser()
	const owner = await login()
	cleanUpUser(owner.id)
	const ownerName = owner.name ?? owner.username
	const viewerName = viewer.name ?? viewer.username
	const { title, printingId } = await seedCard()
	await prisma.collectionEntry.create({
		data: { userId: owner.id, printingId, quantity: 2 },
	})

	// the owner shares with the viewer
	await navigate('/settings/profile/sharing')
	await expect(
		page.getByText('Your collection isn’t shared with anyone.'),
	).toBeVisible()
	await page
		.getByRole('textbox', { name: 'Share with username' })
		.fill(viewer.username)
	await page.getByRole('button', { name: 'Share', exact: true }).click()
	await expect(
		page.getByRole('button', { name: `Stop sharing with ${viewerName}` }),
	).toBeVisible()

	// the viewer finds it under Shared with me
	await page.context().clearCookies()
	await login({ id: viewer.id })
	await navigate('/collection/shared')
	await page.getByRole('link', { name: `${ownerName}’s collection` }).click()
	await expect(page).toHaveURL(`/users/${owner.username}/collection`)
	await expect(
		page.getByRole('heading', { level: 1, name: `${ownerName}’s collection` }),
	).toBeVisible()

	// read-only: the owner's count, and nothing to change it with
	await page.goto(
		`/users/${owner.username}/collection?q=${encodeURIComponent(title)}`,
	)
	const tile = page.getByRole('listitem').filter({
		has: page.getByRole('button', { name: `${title}: show details` }),
	})
	await expect(tile.getByTitle(`${ownerName} owns 2`).first()).toBeVisible()
	await expect(page.getByRole('button', { name: /add one/i })).toHaveCount(0)
	await expect(
		page
			.getByRole('navigation', { name: 'Collection views' })
			.getByRole('link', { name: 'Import/Export' }),
	).toHaveCount(0)

	const importExport = await page.goto(
		`/users/${owner.username}/collection/import-export`,
	)
	expect(importExport?.status()).toBe(404)

	// the viewer removes it, and loses access
	await navigate('/collection/shared')
	await page
		.getByRole('button', { name: `Remove ${ownerName}’s collection` })
		.click()
	await page.getByRole('button', { name: 'Are you sure?' }).click()
	await expect(page.getByText('Nothing shared with you yet')).toBeVisible()
	expect(
		await prisma.collectionShare.count({ where: { ownerId: owner.id } }),
	).toBe(0)

	const removed = await page.goto(`/users/${owner.username}/collection`)
	expect(removed?.status()).toBe(404)
	await expect(page.getByText('No collection shared with you')).toBeVisible()
})
