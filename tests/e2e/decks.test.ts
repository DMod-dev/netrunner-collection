import { randomUUID } from 'node:crypto'
import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test as base } from '#tests/playwright-utils.ts'

type SeededDeckCards = {
	identityTitle: string
	cardTitle: string
	/** the operation's id, which its only printing shares */
	cardId: string
}

/**
 * Inserts a Corp identity and one operation with a unique prefix, so
 * searching for it finds just these whatever else is in the database.
 * Everything is removed again after the test.
 */
const test = base.extend<{ seedDeckCards(): Promise<SeededDeckCards> }>({
	seedDeckCards: async ({}, use) => {
		const id = randomUUID().slice(0, 8)
		const prefix = `Zq${id}`
		const cardIds = [`${id}-identity`, `${id}-operation`]
		const createdTypes: string[] = []
		await use(async () => {
			await prisma.faction.create({
				data: { id, name: `Test Corp ${id}`, sideId: 'corp' },
			})
			// the deck builder knows NetrunnerDB's type ids
			for (const [typeId, name] of [
				['corp_identity', 'Identity'],
				['operation', 'Operation'],
			] as const) {
				if (await prisma.cardType.findUnique({ where: { id: typeId } }))
					continue
				await prisma.cardType.create({ data: { id: typeId, name } })
				createdTypes.push(typeId)
			}
			await prisma.cardCycle.create({
				data: { id, name: `Test Cycle ${id}`, position: 0 },
			})
			await prisma.cardSet.create({
				data: {
					id,
					name: `Test Set ${id}`,
					position: 0,
					size: 2,
					setTypeId: 'core',
					cycleId: id,
				},
			})
			const identityTitle = `${prefix} Identity`
			const cardTitle = `${prefix} Operation`
			const cards = [
				{
					id: cardIds[0]!,
					title: identityTitle,
					typeId: 'corp_identity',
					deckLimit: 1,
					minimumDeckSize: 44,
					influenceLimit: 15,
				},
				{
					id: cardIds[1]!,
					title: cardTitle,
					typeId: 'operation',
					deckLimit: 3,
					influenceCost: 1,
				},
			]
			for (const [i, card] of cards.entries()) {
				await prisma.card.create({
					data: {
						...card,
						strippedTitle: card.title,
						sideId: 'corp',
						factionId: id,
						legalFormats: ',standard,',
						printings: {
							create: {
								id: card.id,
								position: i,
								quantity: 1,
								setId: id,
								isLatest: true,
							},
						},
					},
				})
			}
			return { identityTitle, cardTitle, cardId: cardIds[1]! }
		})
		// a failed test can leave its deck behind
		await prisma.deckCard.deleteMany({ where: { cardId: { in: cardIds } } })
		await prisma.deck.deleteMany({ where: { identityCardId: cardIds[0] } })
		await prisma.printing.deleteMany({ where: { setId: id } })
		await prisma.card.deleteMany({ where: { factionId: id } })
		await prisma.cardSet.deleteMany({ where: { id } })
		await prisma.cardCycle.deleteMany({ where: { id } })
		await prisma.faction.deleteMany({ where: { id } })
		for (const typeId of createdTypes) {
			if (await prisma.card.count({ where: { typeId } })) continue
			await prisma.cardType.delete({ where: { id: typeId } })
		}
	},
})

async function goto(page: Page, path: string) {
	await page.goto(path)
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
}

test('build a deck: pick an identity, add cards, reload, delete', async ({
	page,
	login,
	seedDeckCards,
}) => {
	const { identityTitle, cardTitle } = await seedDeckCards()
	const user = await login()

	await goto(page, '/decks')
	await expect(page.getByText('No decks yet')).toBeVisible()
	await page.getByRole('link', { name: 'New deck' }).first().click()
	await expect(page).toHaveURL('/decks/new')
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })

	await page
		.getByRole('searchbox', { name: 'Search identities' })
		.fill(identityTitle)
	// the radio is visually hidden; its identity art is the label
	const identityRadio = page.getByRole('radio', { name: identityTitle })
	await page.locator('label', { hasText: identityTitle }).click()
	await expect(identityRadio).toBeChecked()
	await page.getByLabel('Name', { exact: true }).fill('E2E Glacier')
	await page.getByRole('button', { name: 'Create deck' }).click()
	// the new deck's builder (not /decks/new, where the form was posted)
	await expect(page).toHaveURL(/\/decks\/(?!new$)[^/]+$/)
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })

	const panel = page.getByRole('complementary', { name: 'Deck' })
	await expect(
		panel.getByRole('heading', { name: identityTitle }),
	).toBeVisible()
	await expect(panel.getByText('0 / 44')).toBeVisible()

	// the browser only shows the deck's side, and no identities
	const browser = page.getByRole('region', { name: 'Card browser' })
	const search = browser.getByRole('searchbox', { name: 'Card name' })
	await search.fill(cardTitle.split(' ')[0]!)
	await search.press('Enter')
	await expect(browser.getByText('1 card', { exact: true })).toBeVisible()

	const tile = browser.getByRole('listitem').filter({
		has: page.getByRole('button', { name: `${cardTitle}: show details` }),
	})
	await tile.hover()
	const add = tile.getByRole('button', {
		name: `Add one ${cardTitle} to the deck`,
	})
	await add.click()
	await add.click()
	await add.click()

	// the stats follow at once
	await expect(panel.getByText('3 / 44')).toBeVisible()
	await expect(panel.getByText('Operation (3)')).toBeVisible()
	await expect
		.poll(() =>
			prisma.deckCard.findFirst({
				where: { deck: { userId: user.id } },
				select: { quantity: true },
			}),
		)
		.toEqual({ quantity: 3 })

	await page.reload()
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
	await expect(panel.getByText('3 / 44')).toBeVisible()
	await expect(panel.getByText('3×')).toBeVisible()

	await goto(page, '/decks')
	await page.getByRole('link', { name: /E2E Glacier/ }).click()
	await expect(panel.getByText('3 / 44')).toBeVisible()

	await page.getByRole('button', { name: 'Delete E2E Glacier' }).click()
	await page.getByRole('button', { name: 'Confirm delete E2E Glacier' }).click()
	await expect(page).toHaveURL('/decks')
	await expect(page.getByText('Deck deleted')).toBeVisible()
	await expect(page.getByText('No decks yet')).toBeVisible()
	expect(await prisma.deck.count({ where: { userId: user.id } })).toBe(0)
})

test('the builder fits a phone screen, with the deck in a bottom sheet', async ({
	page,
	login,
	seedDeckCards,
}) => {
	const { identityTitle } = await seedDeckCards()
	const user = await login()
	const identity = await prisma.card.findFirstOrThrow({
		where: { title: identityTitle },
		select: { id: true },
	})
	const deck = await prisma.deck.create({
		data: {
			userId: user.id,
			name: 'Pocket deck',
			sideId: 'corp',
			identityCardId: identity.id,
		},
	})
	await page.setViewportSize({ width: 375, height: 740 })
	await goto(page, `/decks/${deck.id}`)

	const panel = page.getByRole('complementary', { name: 'Deck' })
	await expect(panel).toBeHidden()
	const toggle = page.getByRole('button', { name: /0 cards · inf 0\/15/ })
	await toggle.click()
	await expect(
		panel.getByRole('heading', { name: identityTitle }),
	).toBeVisible()
	await expect(toggle).toHaveAttribute('aria-expanded', 'true')

	// nothing sticks out sideways
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	)
	expect(overflow).toBeLessThanOrEqual(0)
})

test('fill a deck from the collection, then unfill it', async ({
	page,
	login,
	seedDeckCards,
}) => {
	const { identityTitle, cardTitle, cardId } = await seedDeckCards()
	const user = await login()
	const identity = await prisma.card.findFirstOrThrow({
		where: { title: identityTitle },
		select: { id: true },
	})
	// 3 in the deck, 2 in the collection, and no copy of the identity
	const deck = await prisma.deck.create({
		data: {
			userId: user.id,
			name: 'Filled deck',
			sideId: 'corp',
			identityCardId: identity.id,
			cards: { create: { cardId, quantity: 3 } },
		},
	})
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: cardId, quantity: 2 },
	})
	await goto(page, `/decks/${deck.id}`)

	await page.getByRole('button', { name: 'Fill with collection' }).click()
	await expect(
		page.getByText('Took 2 of 4 cards from your collection'),
	).toBeVisible()
	const panel = page.getByRole('complementary', { name: 'Deck' })
	const row = panel.locator(`[data-deck-card="${cardId}"]`)
	await expect(row.getByText('2/3')).toBeVisible()
	await expect(row.getByText('need 1')).toBeVisible()
	await expect(
		panel.getByRole('region', { name: 'Identity' }).getByText('need 1'),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.deckCard.findFirst({
				where: { deckId: deck.id },
				select: { fromCollection: true },
			}),
		)
		.toEqual({ fromCollection: 2 })

	// the deck list says so too
	await goto(page, '/decks')
	await expect(
		page
			.getByRole('link', { name: /Filled deck/ })
			.getByText('2 cards from collection'),
	).toBeVisible()

	await goto(page, `/decks/${deck.id}`)
	await page.getByRole('button', { name: 'From collection 2/4' }).click()
	await page
		.getByRole('menuitem', { name: 'Unfill (give the cards back)' })
		.click()
	await expect(
		page.getByRole('button', { name: 'Fill with collection' }),
	).toBeVisible()
	await expect(row.getByText('need 1')).toBeHidden()
	expect(
		await prisma.deckCard.findFirst({
			where: { deckId: deck.id },
			select: { fromCollection: true },
		}),
	).toEqual({ fromCollection: 0 })
	// the card stays in the deck
	await expect(row).toContainText(cardTitle)
})

test('import a pasted decklist, then replace its cards from the builder', async ({
	page,
	login,
	seedDeckCards,
}) => {
	const { identityTitle, cardTitle, cardId } = await seedDeckCards()
	const user = await login()
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: cardId, quantity: 2 },
	})

	await goto(page, '/decks/new')
	await page.getByRole('link', { name: 'Import instead' }).click()
	await page
		.getByRole('textbox', { name: 'Deck', exact: true })
		.fill(`My import\n${identityTitle}\n3x ${cardTitle}\n2x Zq No Such Card`)
	await page.getByRole('button', { name: 'Import and fill' }).click()

	await expect(page).toHaveURL(/\/decks\/[^/]+$/)
	await expect(
		page.getByText(
			'Took 2 of 4 cards from your collection. Couldn’t match 1 line:',
		),
	).toBeVisible()
	// listed once, until the toast is closed
	await expect(page.getByText('2x Zq No Such Card')).toHaveCount(1)
	await expect(page.getByLabel('Deck name')).toHaveValue('My import')
	const panel = page.getByRole('complementary', { name: 'Deck' })
	await expect(
		panel.getByRole('region', { name: 'Identity' }).getByText(identityTitle),
	).toBeVisible()
	const row = panel.locator(`[data-deck-card="${cardId}"]`)
	await expect(row.getByText('2/3')).toBeVisible()
	await expect(row.getByText('need 1')).toBeVisible()

	// replace the cards: 2 copies now, and the deck keeps both reserved
	await page.getByRole('button', { name: 'Import', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Import into this deck' })
	await dialog
		.getByRole('textbox', { name: 'Deck', exact: true })
		.fill(`2x ${cardTitle}`)
	await dialog.getByRole('button', { name: 'Replace cards' }).click()
	await dialog.getByRole('button', { name: 'Replace all cards?' }).click()
	await expect(dialog).toBeHidden()
	await expect(row.getByText('2/2')).toBeVisible()
	await expect(row.getByText('need 1')).toBeHidden()
	const deck = await prisma.deck.findFirstOrThrow({
		where: { userId: user.id },
		select: {
			name: true,
			cards: { select: { quantity: true, fromCollection: true } },
		},
	})
	expect(deck).toEqual({
		name: 'My import',
		cards: [{ quantity: 2, fromCollection: 2 }],
	})
})

test('deck check shows copies in use, and saves the deck', async ({
	page,
	login,
	seedDeckCards,
}) => {
	const { identityTitle, cardTitle, cardId } = await seedDeckCards()
	const user = await login()
	const identity = await prisma.card.findFirstOrThrow({
		where: { title: identityTitle },
		select: { id: true },
	})
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: cardId, quantity: 2 },
	})
	// another deck already holds both copies
	await prisma.deck.create({
		data: {
			userId: user.id,
			name: 'Holder',
			sideId: 'corp',
			identityCardId: identity.id,
			cards: { create: { cardId, quantity: 2, fromCollection: 2 } },
		},
	})

	await goto(page, '/collection/deck-check')
	await expect(page.getByText(/Quick check — nothing is saved/)).toBeVisible()
	await page
		.getByRole('textbox', { name: 'Deck', exact: true })
		.fill(`${identityTitle}\n3x ${cardTitle}`)
	await page.getByRole('button', { name: 'Check deck' }).click()
	await expect(page.getByText('2 in use: Holder')).toBeVisible()
	await expect(
		page.getByText(/2 copies are in use by your other decks/),
	).toBeVisible()
	// nothing saved yet
	expect(await prisma.deck.count({ where: { userId: user.id } })).toBe(1)

	await page.getByRole('button', { name: 'Save as deck' }).click()
	await expect(page).toHaveURL(/\/decks\/[^/]+$/)
	await expect(
		page.getByText('None of this deck’s cards are free in your collection'),
	).toBeVisible()
	await expect(page.getByLabel('Deck name')).toHaveValue(identityTitle)
	expect(await prisma.deck.count({ where: { userId: user.id } })).toBe(2)
})
