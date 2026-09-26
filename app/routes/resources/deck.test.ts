import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDeck } from '#app/utils/deck.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { getToast } from '#app/utils/toast.server.ts'
import { action, fillMessage } from './deck.tsx'

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
	return toast && { type: toast.type, description: toast.description }
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
