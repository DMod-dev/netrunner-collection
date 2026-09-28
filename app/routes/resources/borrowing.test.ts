import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { setBorrowed } from '#app/utils/borrowing.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDeck, setDeckCardQuantity } from '#app/utils/deck.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './borrowing.tsx'

// insertCards gives Corroder the printing 30003
const CORRODER_PRINTING = '30003'

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

async function post(cookie: string, fields: Record<string, string>) {
	const request = new Request('http://localhost/resources/borrowing', {
		method: 'POST',
		headers: { cookie },
		body: new URLSearchParams(fields),
	})
	const result = await action({ request } as Parameters<typeof action>[0])
	return { status: result.init?.status ?? 200, ...result.data }
}

/** A lender owning 3 Corroders, sharing with a borrower who asked for 2. */
async function setup() {
	await insertCards()
	const [lender, borrower, stranger] = [
		await insertUser(),
		await insertUser(),
		await insertUser(),
	]
	await prisma.collectionEntry.create({
		data: { userId: lender.id, printingId: CORRODER_PRINTING, quantity: 3 },
	})
	await prisma.collectionShare.create({
		data: { ownerId: lender.id, viewerId: borrower.id },
	})
	const deck = await createDeck(borrower.id, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
	})
	if (!deck) throw new Error('no deck')
	await setDeckCardQuantity(borrower.id, deck.id, 'corroder', 2)
	await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 2)
	const request = await prisma.borrowRequest.findFirstOrThrow({
		select: { id: true },
	})
	return { lender, borrower, stranger, deck, requestId: request.id }
}

const loanStatuses = async () =>
	(await prisma.deckLoan.findMany({ select: { status: true } })).map(
		(l) => l.status,
	)

test('only the lender answers a request, and only the borrower withdraws it', async () => {
	const { lender, borrower, stranger, requestId } = await setup()
	const notPending = {
		status: 404,
		ok: false,
		error: 'That request is no longer pending',
	}
	for (const who of [borrower, stranger]) {
		for (const intent of ['approve', 'reject']) {
			expect(await post(who.cookie, { intent, requestId })).toEqual(notPending)
		}
	}
	for (const who of [lender, stranger]) {
		expect(await post(who.cookie, { intent: 'cancel', requestId })).toEqual(
			notPending,
		)
	}
	expect(await loanStatuses()).toEqual(['pending'])

	expect(
		await post(lender.cookie, { intent: 'approve', requestId }),
	).toMatchObject({ status: 200, ok: true })
	expect(await loanStatuses()).toEqual(['approved'])
})

test('only the lender takes back, and only the borrower answers', async () => {
	const { lender, borrower, stranger, requestId } = await setup()
	await post(lender.cookie, { intent: 'approve', requestId })

	// someone else's (or your own borrowed) copies can't be taken back
	for (const who of [borrower, stranger]) {
		expect(
			await post(who.cookie, { intent: 'revoke', cardId: 'corroder' }),
		).toEqual({ status: 404, ok: false, error: 'Nothing to take back' })
	}
	expect(
		await post(lender.cookie, {
			intent: 'revoke',
			cardId: 'corroder',
			borrowerId: borrower.id,
		}),
	).toMatchObject({ status: 200, ok: true })
	expect(await loanStatuses()).toEqual(['revoked'])

	const { noticeId } = await prisma.deckLoan.findFirstOrThrow({
		select: { noticeId: true },
	})
	for (const who of [lender, stranger]) {
		expect(
			await post(who.cookie, {
				intent: 'answer-notice',
				noticeId: noticeId!,
				answer: 'accept',
			}),
		).toEqual({ status: 404, ok: false, error: 'Nothing left to answer' })
	}
	expect(await loanStatuses()).toEqual(['revoked'])
	expect(
		await post(borrower.cookie, {
			intent: 'answer-notice',
			noticeId: noticeId!,
			answer: 'accept',
		}),
	).toMatchObject({ status: 200, ok: true })
	expect(await loanStatuses()).toEqual([])
})

test('an unknown intent or answer is refused', async () => {
	const { lender } = await setup()
	expect(
		await post(lender.cookie, { intent: 'steal', requestId: 'x' }),
	).toMatchObject({ status: 400, ok: false })
	expect(
		await post(lender.cookie, {
			intent: 'answer-notice',
			noticeId: 'x',
			answer: 'maybe',
		}),
	).toMatchObject({ status: 400, ok: false })
})
