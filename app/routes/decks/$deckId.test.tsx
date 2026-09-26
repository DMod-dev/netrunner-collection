/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { action as deckAction } from '#app/routes/resources/deck.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDeck } from '#app/utils/deck.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { default as DeckBuilderRoute, loader } from './$deckId.tsx'

async function insertUser() {
	const user = await prisma.user.create({
		select: { id: true },
		data: createUser(),
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
	})
	return { ...user, cookie: await getSessionCookieHeader(session) }
}

function renderBuilder(cookie: string, path: string) {
	// the stub's args are untyped; the paths below have what these need
	const App = createRoutesStub([
		{
			path: '/decks/:deckId',
			Component: DeckBuilderRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				return loader(args as Parameters<typeof loader>[0])
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
		{
			path: '/resources/deck',
			action: async (args) => {
				args.request.headers.set('cookie', cookie)
				return deckAction(args as Parameters<typeof deckAction>[0])
			},
		},
	])
	return render(<App initialEntries={[path]} />)
}

test('adding cards from the browser updates the decklist and stats', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await insertUser()
	const deck = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
	})
	renderBuilder(owner.cookie, `/decks/${deck!.id}`)

	const browser = await screen.findByRole('region', { name: 'Card browser' })
	// only the deck's side, and no identities
	expect(within(browser).getByText('1 card')).toBeInTheDocument()
	const panel = screen.getByRole('complementary', { name: 'Deck' })
	expect(within(panel).getByText('0 / 45')).toBeInTheDocument()
	expect(
		within(panel).getByText('No cards yet. Add some from the card browser.'),
	).toBeInTheDocument()

	const add = within(browser).getByRole('button', {
		name: 'Add one Hedge Fund to the deck',
	})
	await user.click(add)
	await user.click(add)
	await user.click(add)

	const operations = await within(panel).findByRole('region', {
		name: 'Operation',
	})
	expect(within(operations).getByText('Hedge Fund')).toBeInTheDocument()
	await within(panel).findByText('3 / 45')
	expect(within(panel).getByText('Operation (3)')).toBeInTheDocument()
	// the problems follow along: too few cards, too few agenda points
	expect(
		within(panel).getByText(/^3 cards; .+ needs at least 45$/),
	).toBeInTheDocument()

	await expect
		.poll(() =>
			prisma.deckCard.findFirst({ select: { cardId: true, quantity: true } }),
		)
		.toEqual({ cardId: 'hedge_fund', quantity: 3 })
})

test('format problems show, as warnings, only with "Require deck legality" on', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await insertUser()
	// Hedge Fund here is only legal in Standard
	const deck = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'startup',
	})
	await prisma.deckCard.create({
		data: { deckId: deck!.id, cardId: 'hedge_fund', quantity: 3 },
	})
	renderBuilder(owner.cookie, `/decks/${deck!.id}`)

	const notInFormat = /^(Error|Warning):.+ isn’t legal in Startup$/
	const formatProblems = () =>
		within(screen.getByRole('region', { name: 'Problems' }))
			.getAllByRole('listitem')
			.map((li) => li.textContent)
			.filter((text) => notInFormat.test(text ?? ''))
	await screen.findByRole('region', { name: 'Problems' })
	expect(formatProblems()).toEqual([])
	// nor are cards in the browser marked
	const browser = screen.getByRole('region', { name: 'Card browser' })
	expect(within(browser).queryAllByText('Not in Startup')).toEqual([])

	await user.click(
		screen.getByRole('switch', { name: 'Require deck legality' }),
	)
	await expect
		.poll(formatProblems)
		.toEqual([
			'Warning:Haas-Bioroid: Precision Design isn’t legal in Startup',
			'Warning:Hedge Fund isn’t legal in Startup',
		])
	await expect
		.poll(() =>
			prisma.deck.findUnique({
				where: { id: deck!.id },
				select: { requireLegality: true },
			}),
		)
		.toEqual({ requireLegality: true })
	expect(within(browser).getAllByText('Not in Startup').length).toBeGreaterThan(
		0,
	)
})

test('"Remove cards not legal" shows with the format checked, and takes them out after a second click', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await insertUser()
	const deck = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'startup',
	})
	await prisma.deckCard.create({
		data: { deckId: deck!.id, cardId: 'hedge_fund', quantity: 3 },
	})
	renderBuilder(owner.cookie, `/decks/${deck!.id}`)

	// not while "Require deck legality" is off
	await screen.findByRole('complementary', { name: 'Deck' })
	expect(
		screen.queryByRole('button', { name: /not legal in Startup/ }),
	).not.toBeInTheDocument()
	await user.click(
		screen.getByRole('switch', { name: 'Require deck legality' }),
	)
	await user.click(
		await screen.findByRole('button', {
			name: 'Remove 3 cards not legal in Startup',
		}),
	)
	expect(await prisma.deckCard.count()).toBe(1)
	await user.click(screen.getByRole('button', { name: 'Remove 3 cards?' }))
	await expect.poll(() => prisma.deckCard.count()).toBe(0)
	expect(
		await screen.findByText('No cards yet. Add some from the card browser.'),
	).toBeInTheDocument()
	expect(
		screen.queryByRole('button', { name: /not legal in Startup/ }),
	).not.toBeInTheDocument()
})

test('filling from the collection shows what’s missing and what’s in use', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await insertUser()
	// 3 Hedge Funds (printing 30001); no copy of the identity
	await prisma.collectionEntry.create({
		data: { userId: owner.id, printingId: '30001', quantity: 3 },
	})
	const other = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
		name: 'Glacier',
	})
	await prisma.deckCard.create({
		data: {
			deckId: other!.id,
			cardId: 'hedge_fund',
			quantity: 1,
			fromCollection: 1,
		},
	})
	const deck = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
	})
	await prisma.deckCard.create({
		data: { deckId: deck!.id, cardId: 'hedge_fund', quantity: 3 },
	})
	renderBuilder(owner.cookie, `/decks/${deck!.id}`)

	const browser = await screen.findByRole('region', { name: 'Card browser' })
	// before filling, the browser counts every copy owned
	expect(
		within(browser).getAllByTitle(/^You own 3; deck limit 3$/),
	).not.toEqual([])
	await user.click(screen.getByRole('button', { name: 'Fill with collection' }))

	const panel = screen.getByRole('complementary', { name: 'Deck' })
	await within(panel).findByText('1 in use: Glacier')
	const row = panel.querySelector('[data-deck-card="hedge_fund"]')!
	expect(within(row as HTMLElement).getByText('2/3')).toBeInTheDocument()
	// the identity isn't owned
	const identity = within(panel).getByRole('region', { name: 'Identity' })
	expect(within(identity).getByText('need 1')).toBeInTheDocument()
	expect(
		screen.getByRole('button', { name: /From collection\s*2\/4/ }),
	).toBeInTheDocument()
	// and the browser counts only the copies other decks don't hold
	expect(within(browser).getAllByTitle(/^2 free of the 3 you own/)).not.toEqual(
		[],
	)
	expect(
		await prisma.deckCard.findUniqueOrThrow({
			where: { deckId_cardId: { deckId: deck!.id, cardId: 'hedge_fund' } },
			select: { fromCollection: true },
		}),
	).toEqual({ fromCollection: 2 })
})

test('each card in the deck takes copies from the collection by hand', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await insertUser()
	// 2 Hedge Funds (printing 30001) and the identity (30000)
	await prisma.collectionEntry.createMany({
		data: [
			{ userId: owner.id, printingId: '30001', quantity: 2 },
			{ userId: owner.id, printingId: '30000', quantity: 1 },
		],
	})
	const deck = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
	})
	await prisma.deckCard.create({
		data: { deckId: deck!.id, cardId: 'hedge_fund', quantity: 3 },
	})
	renderBuilder(owner.cookie, `/decks/${deck!.id}`)

	const panel = await screen.findByRole('complementary', { name: 'Deck' })
	const row = panel.querySelector<HTMLElement>('[data-deck-card="hedge_fund"]')!
	// the card's face, with its copies in the corner
	expect(
		within(row).getByRole('button', { name: 'Hedge Fund: show details' }),
	).toBeInTheDocument()
	expect(within(row).getByText('3×')).toBeInTheDocument()
	const take = within(row).getByRole('button', {
		name: 'Take one Hedge Fund from your collection',
	})
	await user.click(take)
	await user.click(take)
	// only 2 are owned
	await within(row).findByText('2/3')
	expect(take).toBeDisabled()
	expect(within(row).getByText('need 1')).toBeInTheDocument()
	await expect
		.poll(() =>
			prisma.deckCard.findFirst({
				where: { deckId: deck!.id },
				select: { fromCollection: true },
			}),
		)
		.toEqual({ fromCollection: 2 })

	// the identity has one to take
	const identity = within(panel).getByRole('region', { name: 'Identity' })
	await user.click(
		within(identity).getByRole('button', {
			name: 'Take one Haas-Bioroid: Precision Design from your collection',
		}),
	)
	await expect
		.poll(() =>
			prisma.deck.findUnique({
				where: { id: deck!.id },
				select: { identityFromCollection: true },
			}),
		)
		.toEqual({ identityFromCollection: 1 })

	// fewer copies in the deck give reserved ones back
	await user.click(
		within(row).getByRole('button', {
			name: 'Remove one Hedge Fund from the deck',
		}),
	)
	await user.click(
		within(row).getByRole('button', {
			name: 'Remove one Hedge Fund from the deck',
		}),
	)
	await within(row).findByText('1/1')
	await expect
		.poll(() =>
			prisma.deckCard.findFirst({
				where: { deckId: deck!.id },
				select: { quantity: true, fromCollection: true },
			}),
		)
		.toEqual({ quantity: 1, fromCollection: 1 })
})

test('"Copy as text" copies the decklist; an imported deck links back', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await insertUser()
	const deck = await prisma.deck.create({
		data: {
			userId: owner.id,
			name: 'Glacier',
			sideId: 'corp',
			identityCardId: 'precision_design',
			nrdbUrl: 'https://netrunnerdb.com/en/decklist/abc',
			cards: { create: { cardId: 'hedge_fund', quantity: 3 } },
		},
	})
	renderBuilder(owner.cookie, `/decks/${deck.id}`)

	expect(
		await screen.findByRole('link', { name: 'Imported from NetrunnerDB' }),
	).toHaveAttribute('href', 'https://netrunnerdb.com/en/decklist/abc')
	await user.click(screen.getByRole('button', { name: 'Export' }))
	expect(
		await screen.findByRole('menuitem', { name: 'Download .txt' }),
	).toHaveAttribute('href', `/resources/deck-export?deckId=${deck.id}`)
	await user.click(screen.getByRole('menuitem', { name: 'Copy as text' }))
	await expect
		.poll(() => navigator.clipboard.readText())
		.toMatch(
			/^Glacier\nHaas-Bioroid: Precision Design\n\nOperation \(3\)\n3x Hedge Fund\n/,
		)
})

test('someone else’s deck is a 404', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
	})
	const request = new Request(`http://localhost/decks/${deck!.id}`, {
		headers: { cookie: other.cookie },
	})
	await expect(
		loader({ request, params: { deckId: deck!.id } } as Parameters<
			typeof loader
		>[0]),
	).rejects.toMatchObject({ status: 404 })
})
