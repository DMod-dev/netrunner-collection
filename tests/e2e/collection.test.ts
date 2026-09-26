import { randomUUID } from 'node:crypto'
import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test as base } from '#tests/playwright-utils.ts'

type SeededCards = {
	prefix: string
	setId: string
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
			return { prefix, setId: id, setName, titles, printingIds }
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

function sideToggle(page: Page, name: 'Corp' | 'Runner') {
	return page.getByRole('group', { name: 'Side' }).getByRole('button', { name })
}

/** The result count under the filters, which screen readers announce. */
function resultCount(page: Page) {
	return page.getByRole('main').locator('[aria-live]')
}

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
	await expect(resultCount(page)).toHaveText('60 cards')
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
	// nothing left to clear, but the button keeps its place
	await expect(
		page.getByRole('button', { name: 'Clear filters' }),
	).toBeDisabled()

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
	await expect(resultCount(page)).toHaveText('Searching…')
	await expect(cardTile(page, titles[0]!)).toBeAttached()

	release()
	await expect(grid).toHaveAttribute('aria-busy', 'false')
	await expect(resultCount(page)).toHaveText('1 card')
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

	const corp = sideToggle(page, 'Corp')
	await corp.click()
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
	await expect(corp).toHaveAttribute('aria-pressed', 'false')
	await expect(empty).toBeHidden()
})

test('picking a side turns off the other side’s factions', async ({
	page,
	login,
	seedCards,
}) => {
	await seedCards(1)
	await login()
	await gotoCollection(page, '?side=runner')

	const faction = page
		.getByRole('group', { name: 'Faction' })
		.getByRole('button', { name: 'Test Faction' })
	await faction.click()
	await expect(faction).toHaveAttribute('aria-pressed', 'true')
	await expect(page).toHaveURL(/faction=/)

	// both sides: the faction stays
	const corp = sideToggle(page, 'Corp')
	await corp.click()
	await expect(page).toHaveURL(/side=runner&side=corp&faction=/)
	await expect(faction).toHaveAttribute('aria-pressed', 'true')

	await sideToggle(page, 'Runner').click()
	await expect(page).toHaveURL('/collection?side=corp')
	await expect(faction).toHaveAttribute('aria-pressed', 'false')
	await expect(faction).toBeDisabled()

	// no side: every faction can be picked again
	await corp.click()
	await expect(page).toHaveURL('/collection')
	await expect(faction).toBeEnabled()
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

test('set rows show keyboard focus', async ({ page, login, seedCards }) => {
	const { setId, setName } = await seedCards(1)
	await login()
	await page.goto('/collection/sets')
	const row = page.getByRole('link', { name: new RegExp(`^${setName}`) })
	await expect(row).toHaveAttribute('href', `/collection/sets/${setId}`)

	// land on the row from the keyboard, as a Tab would
	await row.focus()
	await page.keyboard.press('Shift+Tab')
	await page.keyboard.press('Tab')
	await expect(row).toBeFocused()
	expect(await row.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
	expect(await row.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(
		'none',
	)
})

test('a set page filters to missing cards and adds whole products', async ({
	page,
	login,
	seedCards,
}) => {
	const { setId, titles, printingIds } = await seedCards(3)
	const user = await login()
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: printingIds[0]!, quantity: 1 },
	})
	await page.goto(`/collection/sets/${setId}`)
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
	const tiles = page.getByRole('main').getByRole('listitem')
	await expect(tiles).toHaveCount(3)

	// the switch works from the keyboard and keeps its state in the URL
	const missingOnly = page.getByRole('switch', {
		name: 'Only show missing cards',
	})
	await missingOnly.focus()
	await page.keyboard.press('Space')
	await expect(page).toHaveURL(`/collection/sets/${setId}?show=missing`)
	await expect(missingOnly).toBeChecked()
	await expect(tiles).toHaveCount(2)
	await expect(page.getByText(titles[0]!)).toHaveCount(0)
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(`/collection/sets/${setId}`)
	await expect(tiles).toHaveCount(3)

	// 2 products of 3 single-copy cards, after a confirm
	const products = page.getByRole('spinbutton', { name: 'Number of products' })
	await products.fill('2')
	await page.getByRole('button', { name: 'Add', exact: true }).click()
	await page.getByRole('button', { name: 'Add 6 cards?' }).click()
	await expect(page.getByText('Added 6 cards')).toBeVisible()
	// and the form is back to its defaults
	await expect(products).toHaveValue('1')
	await expect(
		page.getByRole('combobox', { name: 'Add or remove' }),
	).toHaveValue('add')
	await expect(
		page.getByRole('button', { name: 'Add', exact: true }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.collectionEntry.aggregate({
				where: { userId: user.id, printingId: { in: printingIds } },
				_sum: { quantity: true },
			}),
		)
		.toMatchObject({ _sum: { quantity: 7 } })
})

test('import errors show under the data, and "Done!" clears on edit', async ({
	page,
	login,
	seedCards,
}) => {
	const { printingIds } = await seedCards(1)
	const user = await login()
	await page.goto('/collection/import-export')
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
	const data = page.getByRole('textbox', { name: /paste CSV/ })

	await page.getByRole('button', { name: 'Preview import' }).click()
	const error = page.getByRole('alert').filter({ hasText: 'Choose a file' })
	await expect(error).toBeVisible()
	// straight after the textarea, before the import options
	expect(
		await data.evaluate((el) => el.nextElementSibling?.textContent),
	).toContain('Choose a file')
	await expect(data).toHaveAttribute('aria-invalid', 'true')

	await data.fill(`printing_id,quantity\n${printingIds[0]},2`)
	await expect(error).toHaveCount(0)
	await page.getByRole('button', { name: 'Preview import' }).click()
	await page
		.getByRole('button', { name: 'Add 2 copies to my collection' })
		.click()
	await expect(page.getByText('Imported 2 copies')).toBeVisible()
	await expect
		.poll(() =>
			prisma.collectionEntry.findFirst({
				where: { userId: user.id, printingId: printingIds[0] },
				select: { quantity: true },
			}),
		)
		.toEqual({ quantity: 2 })

	const done = page.getByRole('link', { name: 'View your collection' })
	await expect(done).toBeVisible()
	await data.fill('card,quantity')
	await expect(done).toHaveCount(0)
})
