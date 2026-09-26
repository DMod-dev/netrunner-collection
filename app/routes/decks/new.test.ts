import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getToast } from '#app/utils/toast.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './new.tsx'

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

/** Runs the action as the user with that cookie; a thrown redirect is returned. */
async function post(cookie: string, fields: Record<string, string>) {
	const request = new Request('http://localhost/decks/new?mode=import', {
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

test('importing creates the deck, fills it and opens it with a toast', async () => {
	await insertCards()
	const user = await insertUser()
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: '30003', quantity: 2 },
	})

	const result = await post(user.cookie, {
		intent: 'import',
		deck: 'The Catalyst: Convention Breaker\n3x Corroder\n2x Unknown Card',
		formatId: 'standard',
		requireLegality: 'false',
	})

	if (!(result instanceof Response)) throw new Error('expected a redirect')
	const deck = await prisma.deck.findFirstOrThrow({
		where: { userId: user.id },
		select: {
			id: true,
			requireLegality: true,
			identityCardId: true,
			cards: { select: { cardId: true, quantity: true, fromCollection: true } },
		},
	})
	expect(result.status).toBe(302)
	expect(result.headers.get('location')).toBe(`/decks/${deck.id}`)
	expect(deck).toMatchObject({
		requireLegality: false,
		identityCardId: 'the_catalyst',
		cards: [{ cardId: 'corroder', quantity: 3, fromCollection: 2 }],
	})
	const cookie = result.headers.get('set-cookie')?.split(';')[0] ?? ''
	const { toast } = await getToast(
		new Request('http://localhost/', { headers: { cookie } }),
	)
	expect(toast).toMatchObject({
		title: 'Deck imported',
		description:
			'Took 2 of 4 cards from your collection. Couldn’t match 1 line:',
		details: ['2x Unknown Card'],
	})
})

test('an import that fails goes back to the form with the pasted text', async () => {
	await insertCards()
	const user = await insertUser()
	const result = await post(user.cookie, {
		intent: 'import',
		deck: 'no cards in here',
	})
	if (result instanceof Response || !result || !('init' in result)) {
		throw new Error('expected data')
	}
	expect(result.init?.status).toBe(400)
	expect(result.data).toEqual({
		error: expect.stringMatching(/couldn’t find any cards/i),
		input: 'no cards in here',
	})
	expect(await prisma.deck.count()).toBe(0)
})

test('creating from an identity still works without an intent', async () => {
	await insertCards()
	const user = await insertUser()
	const result = await post(user.cookie, {
		identityCardId: 'precision_design',
		formatId: 'standard',
	})
	expect(result).toBeInstanceOf(Response)
	expect(await prisma.deck.findFirst({ select: { name: true } })).toEqual({
		name: 'Haas-Bioroid: Precision Design',
	})
})
