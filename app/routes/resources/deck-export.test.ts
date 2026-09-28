import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './deck-export.ts'

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

async function get(cookie: string, deckId: string) {
	const request = new Request(
		`http://localhost/resources/deck-export?deckId=${deckId}`,
		{ headers: { cookie } },
	)
	try {
		return await loader({ request } as Parameters<typeof loader>[0])
	} catch (error) {
		if (error instanceof Response) return error
		throw error
	}
}

test('downloads a public deck as text for anyone; a private one only for its owner', async () => {
	await insertCards()
	const owner = await insertUser()
	const other = await insertUser()
	const deck = await prisma.deck.create({
		data: {
			userId: owner.id,
			name: 'Glacier / v2',
			sideId: 'corp',
			identityCardId: 'precision_design',
			cards: { create: { cardId: 'hedge_fund', quantity: 3 } },
		},
	})

	const response = await get(owner.cookie, deck.id)
	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
	expect(response.headers.get('content-disposition')).toBe(
		`attachment; filename="Glacier-v2.txt"; filename*=UTF-8''Glacier%20-%20v2.txt`,
	)
	expect(await response.text()).toMatch(
		/^Glacier \/ v2\nHaas-Bioroid: Precision Design\n\nOperation \(3\)\n3x Hedge Fund\n/,
	)

	// public by default: anyone, signed in or not
	expect((await get(other.cookie, deck.id)).status).toBe(200)
	expect((await get('', deck.id)).status).toBe(200)

	await prisma.deck.update({
		where: { id: deck.id },
		data: { isPublic: false },
	})
	expect((await get(owner.cookie, deck.id)).status).toBe(200)
	expect((await get(other.cookie, deck.id)).status).toBe(404)
	expect((await get('', deck.id)).status).toBe(404)
})
