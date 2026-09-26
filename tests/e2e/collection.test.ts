import { randomUUID } from 'node:crypto'
import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test as base } from '#tests/playwright-utils.ts'

type SeededCards = {
	prefix: string
	setName: string
	titles: string[]
	printingIds: string[]
}

/**
 * Inserts `count` cards whose titles share a unique prefix, so searching for
 * it finds exactly these cards, in title order, whatever else is in the
 * database. Everything is removed again after the test.
 */
const test = base.extend<{ seedCards(count: number): Promise<SeededCards> }>({
	seedCards: async ({}, use) => {
		const ids: string[] = []
		await use(async (count) => {
			const id = randomUUID().slice(0, 8)
			ids.push(id)
			const prefix = `Zq${id}`
			const setName = `Test Set ${id}`
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
					name: setName,
					position: 0,
					size: count,
					setTypeId: 'core',
					cycleId: id,
				},
			})
			const titles = Array.from(
				{ length: count },
				(_, i) => `${prefix} Card ${String(i).padStart(2, '0')}`,
			)
			for (const [i, title] of titles.entries()) {
				await prisma.card.create({
					data: {
						id: `${id}-${i}`,
						title,
						strippedTitle: title,
						sideId: 'runner',
						deckLimit: 3,
						factionId: id,
						typeId: id,
						printings: {
							create: { id: `${id}-${i}`, position: i, quantity: 1, setId: id },
						},
					},
				})
			}
			const printingIds = titles.map((_, i) => `${id}-${i}`)
			return { prefix, setName, titles, printingIds }
		})
		for (const id of ids) {
			const printing = { setId: id }
			await prisma.collectionEntry.deleteMany({ where: { printing } })
			await prisma.variant.deleteMany({ where: { printing } })
			await prisma.printing.deleteMany({ where: printing })
			await prisma.card.deleteMany({ where: { factionId: id } })
			await prisma.cardSet.deleteMany({ where: { id } })
			await prisma.cardCycle.deleteMany({ where: { id } })
			await prisma.cardType.deleteMany({ where: { id } })
			await prisma.faction.deleteMany({ where: { id } })
		}
	},
})

async function gotoCollection(page: Page, search = '') {
	await page.goto(`/collection${search}`)
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

function cardTile(page: Page, title: string) {
	return page.getByRole('listitem').filter({
		has: page.getByRole('button', { name: `${title}: show details` }),
	})
}

test('searching, paging and clearing filters stay in place', async ({
	page,
	login,
	seedCards,
}) => {
	// two full pages, so paging doesn't change the page height
	const { prefix, titles } = await seedCards(60)
	await login()
	await gotoCollection(page)

	let loads = 0
	page.on('load', () => loads++)
	const dataRequests: URL[] = []
	page.on('request', (request) => {
		const url = new URL(request.url())
		if (url.pathname.endsWith('.data')) dataRequests.push(url)
	})

	// Enter runs the search right away and cancels the debounced one
	await page.evaluate(() => window.scrollTo(0, 100))
	const search = page.getByRole('searchbox', { name: 'Card name' })
	await search.fill(prefix)
	await search.press('Enter')
	await expect(page.getByText('60 cards')).toBeVisible()
	await page.waitForTimeout(600) // longer than the debounce
	expect(dataRequests).toHaveLength(1)
	expect(dataRequests[0]!.pathname).toBe('/collection.data')
	// only the page's loader runs, not the root's
	expect(dataRequests[0]!.searchParams.get('_routes')).toBe(
		'routes/collection/index',
	)
	expect(await scrollY(page)).toBe(100)

	const next = page.getByRole('link', { name: 'Next' })
	await next.scrollIntoViewIfNeeded()
	const bottom = await scrollY(page)
	expect(bottom).toBeGreaterThan(100)
	await next.click()
	await expect(page.getByText('Page 2 of 2')).toBeVisible()
	await expect(cardTile(page, titles[30]!)).toBeAttached()
	expect(await scrollY(page)).toBe(bottom)

	// a new search starts again from page 1
	await search.fill(`${prefix} Card`)
	await search.press('Enter')
	await expect(page.getByText('Page 1 of 2')).toBeVisible()
	await expect(page).not.toHaveURL(/page=/)
	await expect(cardTile(page, titles[0]!)).toBeAttached()

	await page.evaluate(() => window.scrollTo(0, 150))
	await page.getByRole('link', { name: 'Clear filters' }).click()
	await expect(page).toHaveURL('/collection')
	await expect(search).toHaveValue('')
	expect(await scrollY(page)).toBe(150)

	expect(loads).toBe(0)
})

test('the current cards stay up while a search loads', async ({
	page,
	login,
	seedCards,
}) => {
	const { prefix, titles } = await seedCards(2)
	await login()
	await gotoCollection(page)

	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(
		(url) => url.pathname === '/collection.data',
		async (route) => {
			await held
			await route.continue()
		},
	)

	const search = page.getByRole('searchbox', { name: 'Card name' })
	await search.fill(`${prefix} Card 01`)
	await search.press('Enter')

	const grid = page.locator('ul[aria-busy]')
	await expect(grid).toHaveAttribute('aria-busy', 'true')
	await expect(page.getByRole('main').locator('[aria-live]')).toHaveText(
		'Searching…',
	)
	await expect(cardTile(page, titles[0]!)).toBeAttached()

	release()
	await expect(grid).toHaveAttribute('aria-busy', 'false')
	await expect(page.getByRole('main').locator('[aria-live]')).toHaveText(
		'1 card',
	)
	await expect(cardTile(page, titles[0]!)).toHaveCount(0)
	await expect(cardTile(page, titles[1]!)).toBeAttached()
})

test('with no results, "Clear filters" resets the search', async ({
	page,
	login,
	seedCards,
}) => {
	await seedCards(1)
	await login()
	await gotoCollection(page)

	const side = page.getByRole('combobox', { name: 'Side' })
	await side.selectOption('corp')
	const search = page.getByRole('searchbox', { name: 'Card name' })
	await search.fill(`no card is called ${randomUUID()}`)
	await search.press('Enter')

	const empty = page.getByRole('region', {
		name: 'No cards match these filters',
	})
	await expect(empty).toBeVisible()
	await expect(
		empty.getByRole('link', { name: 'Import cards' }),
	).toHaveAttribute('href', '/collection/import-export')
	await empty.getByRole('link', { name: 'Clear filters' }).click()

	await expect(page).toHaveURL('/collection')
	await expect(search).toHaveValue('')
	await expect(side).toHaveValue('')
	await expect(empty).toBeHidden()
})

test('picking another side drops a faction from the old one', async ({
	page,
	login,
	seedCards,
}) => {
	await seedCards(1)
	await login()
	await gotoCollection(page, '?side=runner')

	const faction = page.getByRole('combobox', { name: 'Faction' })
	await faction.selectOption({ label: 'Test Faction' })
	await expect(page).toHaveURL(/faction=/)

	await page.getByRole('combobox', { name: 'Side' }).selectOption('corp')
	await expect(page).toHaveURL('/collection?side=corp')
	await expect(faction).toHaveValue('')
})

test('tiles show the owned count and change it', async ({
	page,
	login,
	seedCards,
}) => {
	const { prefix, setName, titles, printingIds } = await seedCards(1)
	const user = await login()
	await gotoCollection(page, `?q=${prefix}`)
	const title = titles[0]!
	const tile = cardTile(page, title)

	// visible without hovering (the overlay has its own copy)
	await expect(tile.getByText('0 / 3').first()).toBeVisible()

	const add = tile.getByRole('button', {
		name: `Add one ${title} (${setName})`,
	})
	const quantity = tile.getByRole('textbox', {
		name: `${title} (${setName}) quantity`,
	})

	// optimistic: presses count right away, even while earlier ones are
	// still saving
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	const saveUrl = (url: URL) => url.pathname === '/resources/collection.data'
	await page.route(saveUrl, async (route) => {
		await held
		// the second press cancels the first request in the browser
		await route.continue().catch(() => {})
	})
	await tile.hover()
	await add.click()
	await add.click()
	await expect(quantity).toHaveValue('2')
	release()
	await expect
		.poll(() =>
			prisma.collectionEntry.findFirst({
				where: { userId: user.id, printingId: printingIds[0] },
				select: { quantity: true },
			}),
		)
		.toEqual({ quantity: 2 })
	await page.unroute(saveUrl)

	// keyboard shortcuts change the hovered tile
	await page.keyboard.press('+')
	await expect(quantity).toHaveValue('3')
	await expect
		.poll(() =>
			prisma.collectionEntry.findFirst({
				where: { userId: user.id, printingId: printingIds[0] },
				select: { quantity: true },
			}),
		)
		.toEqual({ quantity: 3 })

	await page.mouse.move(0, 0)
	await expect(tile.getByText('3 / 3').first()).toBeVisible()
})

test('a failed quantity change is reported and undone', async ({
	page,
	login,
	seedCards,
}) => {
	const { prefix, setName, titles } = await seedCards(1)
	await login()
	await gotoCollection(page, `?q=${prefix}`)
	const title = titles[0]!
	const tile = cardTile(page, title)

	await page.route(
		(url) => url.pathname === '/resources/collection.data',
		(route) => route.fulfill({ status: 500, body: 'Internal Server Error' }),
	)
	await tile.hover()
	await tile
		.getByRole('button', { name: `Add one ${title} (${setName})` })
		.click()

	await expect(page.getByText(/couldn’t save your change/i)).toBeVisible()
	await expect(
		tile.getByRole('textbox', { name: `${title} (${setName}) quantity` }),
	).toHaveValue('0')
	// the page itself is still there, not the error boundary
	await expect(
		page.getByRole('heading', { level: 1, name: 'My collection' }),
	).toBeVisible()
})
