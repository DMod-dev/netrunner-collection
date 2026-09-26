import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDeck } from '#app/utils/deck.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { getToast } from '#app/utils/toast.server.ts'
import { action, fillMessage, importToast } from './deck.tsx'

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

async function insertDeck(userId: string) {
	const deck = await createDeck(userId, {
		identityCardId: 'precision_design',
		formatId: 'standard',
	})
	if (!deck) throw new Error('no deck')
	return deck
}

/** Runs the action as the user with that cookie; a thrown redirect is returned. */
async function post(cookie: string, fields: Record<string, string>) {
	const request = new Request('http://localhost/resources/deck', {
		method: 'POST',
		headers: { cookie },
		body: new URLSearchParams(fields),
	})
	try {
		return await action({ request } as Parameters<typeof action>[0])
	} catch (error) {
		if (error instanceof Response) return error
		throw error
	}
}

/** The status and body of what the action returned. */
function outcome(result: Awaited<ReturnType<typeof post>>) {
	if (result instanceof Response) {
		return { status: result.status, location: result.headers.get('location') }
	}
	if (result && 'init' in result) {
		return { status: result.init?.status ?? 200, ...result.data }
	}
	return { status: 200, ...result }
}

test('set-card-quantity validates the count', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	const setQuantity = (quantity: string) =>
		post(user.cookie, {
			intent: 'set-card-quantity',
			deckId: deck.id,
			cardId: 'hedge_fund',
			quantity,
		}).then(outcome)

	for (const bad of ['-1', '10', '1.5', 'three', '']) {
		expect(await setQuantity(bad)).toMatchObject({ status: 400, ok: false })
	}
	expect(await prisma.deckCard.count()).toBe(0)

	expect(await setQuantity('3')).toEqual({ status: 200, ok: true })
	expect(
		await prisma.deckCard.findFirstOrThrow({ select: { quantity: true } }),
	).toEqual({ quantity: 3 })
	expect(await setQuantity('0')).toEqual({ status: 200, ok: true })
	expect(await prisma.deckCard.count()).toBe(0)
})

test('every intent 404s on someone else’s deck', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await insertDeck(owner.id)
	await prisma.deckCard.create({
		data: { deckId: deck.id, cardId: 'hedge_fund', quantity: 2 },
	})
	const before = await prisma.deck.findUniqueOrThrow({
		where: { id: deck.id },
		include: { cards: true },
	})

	const attempts: Array<Record<string, string>> = [
		{ intent: 'set-card-quantity', cardId: 'hedge_fund', quantity: '3' },
		{ intent: 'set-identity', identityCardId: 'precision_design' },
		{ intent: 'rename', name: 'Stolen' },
		{ intent: 'set-notes', notes: 'mine now' },
		{ intent: 'set-format', formatId: 'eternal' },
		{ intent: 'set-require-legality', requireLegality: 'false' },
		{ intent: 'fill' },
		{ intent: 'unfill' },
		{ intent: 'import', deck: '1x Hedge Fund' },
		{ intent: 'delete' },
	]
	for (const fields of attempts) {
		expect(
			outcome(await post(other.cookie, { ...fields, deckId: deck.id })),
		).toEqual({ status: 404, ok: false, error: 'Deck not found' })
	}
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: deck.id },
			include: { cards: true },
		}),
	).toEqual(before)
})

test('rename, notes, format and legality', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	const send = (fields: Record<string, string>) =>
		post(user.cookie, { ...fields, deckId: deck.id }).then(outcome)
	const saved = () =>
		prisma.deck.findUniqueOrThrow({
			where: { id: deck.id },
			select: {
				name: true,
				notes: true,
				formatId: true,
				requireLegality: true,
			},
		})

	expect(await send({ intent: 'rename', name: '   ' })).toMatchObject({
		status: 400,
		error: 'Give the deck a name',
	})
	expect(
		await send({ intent: 'set-format', formatId: 'casual' }),
	).toMatchObject({ status: 400 })

	await send({ intent: 'rename', name: '  Glacier  ' })
	await send({ intent: 'set-notes', notes: 'Mulligan for ice' })
	await send({ intent: 'set-format', formatId: 'eternal' })
	await send({ intent: 'set-require-legality', requireLegality: 'false' })
	expect(await saved()).toEqual({
		name: 'Glacier',
		notes: 'Mulligan for ice',
		formatId: 'eternal',
		requireLegality: false,
	})

	// clearing the notes stores nothing
	await send({ intent: 'set-notes', notes: '  ' })
	expect(await saved()).toMatchObject({ notes: null })
})

test('set-identity reports why it refused', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await prisma.deckCard.create({
		data: { deckId: deck.id, cardId: 'hedge_fund', quantity: 2 },
	})

	expect(
		outcome(
			await post(user.cookie, {
				intent: 'set-identity',
				deckId: deck.id,
				identityCardId: 'the_catalyst',
			}),
		),
	).toMatchObject({ status: 400, error: expect.stringContaining('empty') })
})

/** The toast an action's response sets, as the next page load reads it. */
async function toastOf(result: Awaited<ReturnType<typeof post>>) {
	const headers =
		result && !(result instanceof Response) && 'init' in result
			? new Headers(result.init?.headers)
			: null
	const cookie = headers?.get('set-cookie')?.split(';')[0]
	if (!cookie) return null
	const { toast } = await getToast(
		new Request('http://localhost/', { headers: { cookie } }),
	)
	return (
		toast && {
			type: toast.type,
			description: toast.description,
			...(toast.details ? { details: toast.details } : {}),
		}
	)
}

test('fill and unfill reserve copies and say how it went', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await prisma.deckCard.create({
		data: { deckId: deck.id, cardId: 'hedge_fund', quantity: 3 },
	})
	// 2 Hedge Funds (printing 30001), and the identity (30000)
	await prisma.collectionEntry.createMany({
		data: [
			{ userId: user.id, printingId: '30001', quantity: 2 },
			{ userId: user.id, printingId: '30000', quantity: 1 },
		],
	})
	const send = (intent: string) =>
		post(user.cookie, { intent, deckId: deck.id })

	const filled = await send('fill')
	expect(outcome(filled)).toEqual({ status: 200, ok: true })
	expect(await toastOf(filled)).toEqual({
		type: 'message',
		description: 'Took 3 of 4 cards from your collection',
	})
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: deck.id },
			select: {
				identityFromCollection: true,
				cards: { select: { fromCollection: true } },
			},
		}),
	).toEqual({ identityFromCollection: 1, cards: [{ fromCollection: 2 }] })

	const unfilled = await send('unfill')
	expect(outcome(unfilled)).toEqual({ status: 200, ok: true })
	expect(await toastOf(unfilled)).toMatchObject({ type: 'success' })
	expect(
		await prisma.deck.findUniqueOrThrow({
			where: { id: deck.id },
			select: {
				identityFromCollection: true,
				cards: { select: { fromCollection: true } },
			},
		}),
	).toEqual({ identityFromCollection: 0, cards: [{ fromCollection: 0 }] })
})

test('import replaces the cards, fills a filled deck again, and lists unknown lines', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)
	await prisma.deckCard.create({
		data: { deckId: deck.id, cardId: 'hedge_fund', quantity: 1 },
	})
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: '30001', quantity: 3 },
	})
	const send = (text: string) =>
		post(user.cookie, { intent: 'import', deckId: deck.id, deck: text })

	// not filled: it stays that way
	const plain = await send('2x Hedge Fund')
	expect(outcome(plain)).toEqual({ status: 200, ok: true })
	expect(await toastOf(plain)).toEqual({
		type: 'success',
		description: 'Replaced this deck’s cards',
	})
	expect(
		await prisma.deckCard.findMany({
			select: { quantity: true, fromCollection: true },
		}),
	).toEqual([{ quantity: 2, fromCollection: 0 }])

	await post(user.cookie, { intent: 'fill', deckId: deck.id })
	const filled = await send('3x Hedge Fund\n1x Nope')
	expect(await toastOf(filled)).toEqual({
		type: 'message',
		// no copy of the identity
		description:
			'Took 3 of 4 cards from your collection. Couldn’t match 1 line:',
		details: ['1x Nope'],
	})
	expect(
		await prisma.deckCard.findMany({
			select: { quantity: true, fromCollection: true },
		}),
	).toEqual([{ quantity: 3, fromCollection: 3 }])

	expect(outcome(await send('nothing here'))).toMatchObject({
		status: 400,
		ok: false,
		error: expect.stringMatching(/couldn’t find any cards/i),
	})
})

test('importToast lists at most a few unknown lines, shortened', () => {
	const lines = Array.from({ length: 12 }, (_, i) => `${i}x ${'x'.repeat(90)}`)
	const toast = importToast({
		title: 'Deck imported',
		report: { taken: 45, total: 45 },
		unfilled: '',
		unrecognized: lines,
	})
	expect(toast.description).toBe(
		'Took all 45 cards from your collection. Couldn’t match 12 lines:',
	)
	expect(toast.details).toHaveLength(11)
	expect(toast.details?.[0]).toHaveLength(80)
	expect(toast.details?.at(-1)).toBe('…and 2 more')
})

test('fillMessage', () => {
	expect(fillMessage({ taken: 45, total: 45 })).toBe(
		'Took all 45 cards from your collection',
	)
	expect(fillMessage({ taken: 41, total: 45 })).toBe(
		'Took 41 of 45 cards from your collection',
	)
	expect(fillMessage({ taken: 0, total: 45 })).toBe(
		'None of this deck’s cards are free in your collection',
	)
	expect(fillMessage({ taken: 1, total: 1 })).toBe(
		'Took the card from your collection',
	)
})

test('delete redirects to the deck list', async () => {
	await insertCards()
	const user = await insertUser()
	const deck = await insertDeck(user.id)

	expect(
		outcome(await post(user.cookie, { intent: 'delete', deckId: deck.id })),
	).toEqual({ status: 302, location: '/decks' })
	expect(await prisma.deck.count()).toBe(0)
})

test('signed out, it sends you to log in', async () => {
	const result = await post('', {
		intent: 'delete',
		deckId: 'anything',
	})
	expect(outcome(result)).toMatchObject({ status: 302 })
	expect((result as Response).headers.get('location')).toMatch(/^\/login/)
})
