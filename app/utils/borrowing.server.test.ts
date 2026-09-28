import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import {
	answerNotice,
	cancelRequest,
	fillFromLender,
	getBorrowingNotifications,
	getBorrowingOverview,
	getCopiesLent,
	respondToRequest,
	returnToLender,
	revokeCard,
	setBorrowed,
} from './borrowing.server.ts'
import { removeShare } from './collection-share.server.ts'
import { prisma } from './db.server.ts'
import {
	fillDeck,
	getAvailability,
	setFromCollection,
} from './deck-fill.server.ts'
import { createDeck, deleteDeck, setDeckCardQuantity } from './deck.server.ts'

// insertCards gives each card one printing: 30002 is The Catalyst, 30003
// is Corroder.
const CATALYST_PRINTING = '30002'
const CORRODER_PRINTING = '30003'

async function insertUser() {
	return prisma.user.create({ data: createUser(), select: { id: true } })
}

async function own(userId: string, printingId: string, quantity: number) {
	await prisma.collectionEntry.upsert({
		where: { userId_printingId: { userId, printingId } },
		create: { userId, printingId, quantity },
		update: { quantity },
	})
}

async function share(ownerId: string, viewerId: string) {
	return prisma.collectionShare.create({
		data: { ownerId, viewerId },
		select: { id: true },
	})
}

/** A Catalyst deck with `corroders` Corroders. */
async function insertDeck(userId: string, name: string, corroders: number) {
	const deck = await createDeck(userId, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name,
	})
	if (!deck) throw new Error('no deck')
	if (corroders) {
		await setDeckCardQuantity(userId, deck.id, 'corroder', corroders)
	}
	return deck
}

/** A lender owning 3 Corroders and a Catalyst, sharing with a borrower. */
async function setup() {
	await insertCards()
	const lender = await insertUser()
	const borrower = await insertUser()
	await own(lender.id, CORRODER_PRINTING, 3)
	await own(lender.id, CATALYST_PRINTING, 1)
	const shareRow = await share(lender.id, borrower.id)
	return { lender, borrower, shareId: shareRow.id }
}

/** "status:quantity" for each of a deck's Corroder loans, sorted. */
async function corroderLoans(deckId: string) {
	const rows = await prisma.deckLoan.findMany({
		where: { deckId, cardId: 'corroder' },
		select: { status: true, quantity: true },
	})
	return rows.map((r) => `${r.status}:${r.quantity}`).sort()
}

async function lenderFree(lenderId: string, cardId = 'corroder') {
	return (await getAvailability(lenderId, [cardId], null)).get(cardId)!
		.available
}

async function pendingRequest(borrowerId: string) {
	return prisma.borrowRequest.findFirstOrThrow({
		where: { borrowerId, status: 'pending' },
		select: { id: true },
	})
}

test('filling from a lender asks for what the deck lacks and holds it', async () => {
	const { lender, borrower } = await setup()
	await own(borrower.id, CORRODER_PRINTING, 1)
	const deck = await insertDeck(borrower.id, 'A', 3)
	await fillDeck(borrower.id, deck.id)

	// own 1 Corroder; the other 2 and the identity are asked for
	const report = await fillFromLender(borrower.id, deck.id, lender.id)
	expect(report).toMatchObject({ asked: 3, open: 3 })
	expect(report && 'notifications' in report && report.notifications).toEqual([
		{
			kind: 'requested',
			toUserId: lender.id,
			fromUserId: borrower.id,
			copies: 3,
		},
	])
	expect(await corroderLoans(deck.id)).toEqual(['pending:2'])
	// pending copies are held from the lender
	expect(await lenderFree(lender.id)).toBe(1)
	expect((await getBorrowingNotifications(lender.id)).length).toBe(1)

	// filling again adds nothing and sends nothing
	expect(await fillFromLender(borrower.id, deck.id, lender.id)).toMatchObject({
		asked: 0,
		open: 0,
		notifications: [],
	})
})

test('one pending request per lender: more borrowing adds to it', async () => {
	const { lender, borrower } = await setup()
	const a = await insertDeck(borrower.id, 'A', 1)
	const b = await insertDeck(borrower.id, 'B', 1)
	await fillFromLender(borrower.id, a.id, lender.id)
	const second = await fillFromLender(borrower.id, b.id, lender.id)
	expect(second).toMatchObject({ asked: 1, notifications: [] })
	expect(
		await prisma.borrowRequest.count({ where: { borrowerId: borrower.id } }),
	).toBe(1)
	const overview = await getBorrowingOverview(lender.id)
	expect(overview.incoming).toHaveLength(1)
	// the lender sees cards, not deck names
	expect(overview.incoming[0]!.cards).toEqual([
		{ cardId: 'corroder', title: 'Corroder', quantity: 2 },
		{
			cardId: 'the_catalyst',
			title: 'The Catalyst: Convention Breaker',
			quantity: 1,
		},
	])
})

test('approving lends the copies; they stay held from the lender', async () => {
	const { lender, borrower } = await setup()
	const deck = await insertDeck(borrower.id, 'A', 2)
	await fillFromLender(borrower.id, deck.id, lender.id)
	const { id } = await pendingRequest(borrower.id)

	// only the lender can answer
	expect(await respondToRequest(borrower.id, id, 'approve')).toBeNull()
	const result = await respondToRequest(lender.id, id, 'approve')
	expect(result?.copies).toBe(3)
	expect(await corroderLoans(deck.id)).toEqual(['approved:2'])
	expect(await lenderFree(lender.id)).toBe(1)
	expect((await getBorrowingNotifications(lender.id)).length).toBe(0)

	// lent copies can't go into the lender's own decks
	const mine = await insertDeck(lender.id, 'Mine', 3)
	await fillDeck(lender.id, mine.id)
	expect(
		await prisma.deckCard.findUniqueOrThrow({
			where: { deckId_cardId: { deckId: mine.id, cardId: 'corroder' } },
			select: { fromCollection: true },
		}),
	).toEqual({ fromCollection: 1 })
	expect(
		(await getCopiesLent(lender.id, ['corroder'])).get('corroder'),
	).toMatchObject([{ lent: 2, asked: 0 }])
})

test('rejecting marks the copies not lent until the borrower answers', async () => {
	const { lender, borrower } = await setup()
	const deck = await insertDeck(borrower.id, 'A', 2)
	await fillFromLender(borrower.id, deck.id, lender.id)
	const { id } = await pendingRequest(borrower.id)
	await respondToRequest(lender.id, id, 'reject')

	expect(await corroderLoans(deck.id)).toEqual(['rejected:2'])
	// freed on the lender's side at once
	expect(await lenderFree(lender.id)).toBe(3)
	expect((await getBorrowingNotifications(borrower.id)).length).toBe(1)
	expect(await getBorrowingNotifications(borrower.id)).toMatchObject([
		{
			kind: 'notice',
			noticeId: id,
			status: 'rejected',
			copies: 3,
			canAskAgain: true,
		},
	])

	// the rejected copies hold their place: own copies don't fill them yet
	await own(borrower.id, CORRODER_PRINTING, 3)
	await fillDeck(borrower.id, deck.id)
	expect(
		await prisma.deckCard.findUniqueOrThrow({
			where: { deckId_cardId: { deckId: deck.id, cardId: 'corroder' } },
			select: { fromCollection: true },
		}),
	).toEqual({ fromCollection: 0 })

	// accepting leaves plain copies in the deck
	expect(await answerNotice(borrower.id, id, 'accept')).toMatchObject({
		answered: 3,
	})
	expect(await corroderLoans(deck.id)).toEqual([])
	expect((await getBorrowingNotifications(borrower.id)).length).toBe(0)
	await fillDeck(borrower.id, deck.id)
	expect(
		await prisma.deckCard.findUniqueOrThrow({
			where: { deckId_cardId: { deckId: deck.id, cardId: 'corroder' } },
			select: { quantity: true, fromCollection: true },
		}),
	).toEqual({ quantity: 2, fromCollection: 2 })
})

test('asking again after a rejection makes a new pending request', async () => {
	const { lender, borrower } = await setup()
	const deck = await insertDeck(borrower.id, 'A', 3)
	await fillFromLender(borrower.id, deck.id, lender.id)
	const first = await pendingRequest(borrower.id)
	await respondToRequest(lender.id, first.id, 'reject')

	// meanwhile the lender put a Corroder, and their only Catalyst, in a
	// deck of their own
	const mine = await insertDeck(lender.id, 'Mine', 1)
	await fillDeck(lender.id, mine.id)

	const again = await answerNotice(borrower.id, first.id, 'ask-again')
	expect(again).toMatchObject({ answered: 4, asked: 2 })
	expect(await corroderLoans(deck.id)).toEqual(['pending:2'])
	const second = await pendingRequest(borrower.id)
	expect(second.id).not.toBe(first.id)
})

test('the borrowed stepper adds to the request and gives copies back', async () => {
	const { lender, borrower } = await setup()
	await own(borrower.id, CORRODER_PRINTING, 1)
	const deck = await insertDeck(borrower.id, 'A', 3)
	await setFromCollection(borrower.id, deck.id, 'corroder', 1)

	// capped at the copies without a source: 3 played - 1 own
	expect(
		await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 3),
	).toMatchObject({ borrowed: 2 })
	const { id } = await pendingRequest(borrower.id)
	await respondToRequest(lender.id, id, 'approve')

	// one more own copy can't be filled while 2 are borrowed
	await own(borrower.id, CORRODER_PRINTING, 2)
	await fillDeck(borrower.id, deck.id)
	expect(await corroderLoans(deck.id)).toEqual(['approved:2'])

	// giving one back frees it for the lender, no approval needed
	expect(
		await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 1),
	).toMatchObject({ borrowed: 1 })
	expect(await lenderFree(lender.id)).toBe(2)

	// adding again goes into a new request, alongside the lent copy
	await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 2)
	expect(await corroderLoans(deck.id)).toEqual(['approved:1', 'pending:1'])

	// stepping down takes the pending copy first
	await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 1)
	expect(await corroderLoans(deck.id)).toEqual(['approved:1'])
	// and the emptied request is cancelled
	expect(
		await prisma.borrowRequest.count({
			where: { borrowerId: borrower.id, status: 'pending' },
		}),
	).toBe(0)
})

test('revoking one card only affects that card, and one borrower', async () => {
	const { lender, borrower } = await setup()
	const other = await insertUser()
	await share(lender.id, other.id)
	const deck = await insertDeck(borrower.id, 'A', 2)
	const otherDeck = await insertDeck(other.id, 'B', 1)
	await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 2)
	await setBorrowed(borrower.id, deck.id, 'the_catalyst', lender.id, 1)
	await setBorrowed(other.id, otherDeck.id, 'corroder', lender.id, 1)
	await respondToRequest(
		lender.id,
		(await pendingRequest(borrower.id)).id,
		'approve',
	)
	await respondToRequest(
		lender.id,
		(await pendingRequest(other.id)).id,
		'approve',
	)
	expect(await lenderFree(lender.id)).toBe(0)

	const result = await revokeCard(lender.id, 'corroder', borrower.id)
	expect(result.copies).toBe(2)
	expect(result.notifications).toMatchObject([
		{ kind: 'revoked', toUserId: borrower.id, copies: 2 },
	])
	expect(await corroderLoans(deck.id)).toEqual(['revoked:2'])
	expect(await corroderLoans(otherDeck.id)).toEqual(['approved:1'])
	// the identity is still lent
	expect(
		await prisma.deckLoan.findFirstOrThrow({
			where: { deckId: deck.id, cardId: 'the_catalyst' },
			select: { status: true },
		}),
	).toEqual({ status: 'approved' })
	expect(await lenderFree(lender.id)).toBe(2)

	// asking again works like after a rejection
	const notice = await prisma.deckLoan.findFirstOrThrow({
		where: { deckId: deck.id, status: 'revoked' },
		select: { noticeId: true },
	})
	expect(
		await answerNotice(borrower.id, notice.noticeId!, 'ask-again', deck.id),
	).toMatchObject({ answered: 2, asked: 2 })
	expect(await corroderLoans(deck.id)).toEqual(['pending:2'])

	// without a borrower, every borrower's copies go
	await revokeCard(lender.id, 'corroder')
	expect(await corroderLoans(otherDeck.id)).toEqual(['revoked:1'])
})

test('fewer copies in the deck give borrowed ones back before own ones', async () => {
	const { lender, borrower } = await setup()
	await own(borrower.id, CORRODER_PRINTING, 1)
	const deck = await insertDeck(borrower.id, 'A', 3)
	await setFromCollection(borrower.id, deck.id, 'corroder', 1)
	await setBorrowed(borrower.id, deck.id, 'corroder', lender.id, 2)
	await respondToRequest(
		lender.id,
		(await pendingRequest(borrower.id)).id,
		'approve',
	)

	await setDeckCardQuantity(borrower.id, deck.id, 'corroder', 2)
	expect(await corroderLoans(deck.id)).toEqual(['approved:1'])
	expect(
		await prisma.deckCard.findUniqueOrThrow({
			where: { deckId_cardId: { deckId: deck.id, cardId: 'corroder' } },
			select: { fromCollection: true },
		}),
	).toEqual({ fromCollection: 1 })

	await setDeckCardQuantity(borrower.id, deck.id, 'corroder', 0)
	expect(await corroderLoans(deck.id)).toEqual([])
	expect(await lenderFree(lender.id)).toBe(3)
})

test('deleting a deck or withdrawing gives everything back', async () => {
	const { lender, borrower } = await setup()
	const a = await insertDeck(borrower.id, 'A', 2)
	await fillFromLender(borrower.id, a.id, lender.id)
	await deleteDeck(borrower.id, a.id)
	expect(await lenderFree(lender.id)).toBe(3)
	expect(
		await prisma.borrowRequest.findFirstOrThrow({
			where: { borrowerId: borrower.id },
			select: { status: true },
		}),
	).toEqual({ status: 'cancelled' })

	const b = await insertDeck(borrower.id, 'B', 2)
	await fillFromLender(borrower.id, b.id, lender.id)
	const { id } = await pendingRequest(borrower.id)
	expect(await cancelRequest(lender.id, id)).toBe(false)
	expect(await cancelRequest(borrower.id, id)).toBe(true)
	expect(await corroderLoans(b.id)).toEqual([])

	await fillFromLender(borrower.id, b.id, lender.id)
	expect(await returnToLender(borrower.id, b.id, lender.id)).toEqual({
		returned: 3,
	})
	expect(await lenderFree(lender.id)).toBe(3)
})

test('borrowing needs a share; removing it ends every loan', async () => {
	const { lender, borrower, shareId } = await setup()
	const stranger = await insertUser()
	const strangerDeck = await insertDeck(stranger.id, 'S', 1)
	expect(
		await fillFromLender(stranger.id, strangerDeck.id, lender.id),
	).toMatchObject({ status: 400 })

	const a = await insertDeck(borrower.id, 'A', 1)
	const b = await insertDeck(borrower.id, 'B', 1)
	await setBorrowed(borrower.id, a.id, 'corroder', lender.id, 1)
	await respondToRequest(
		lender.id,
		(await pendingRequest(borrower.id)).id,
		'approve',
	)
	await setBorrowed(borrower.id, b.id, 'corroder', lender.id, 1)

	const removed = await removeShare(lender.id, shareId)
	expect(removed?.notifications).toMatchObject([
		{ kind: 'share-ended', toUserId: borrower.id, copies: 2 },
	])
	expect(await corroderLoans(a.id)).toEqual(['revoked:1'])
	expect(await corroderLoans(b.id)).toEqual(['rejected:1'])
	expect(await lenderFree(lender.id)).toBe(3)

	// only accepting is left
	const notice = await prisma.deckLoan.findFirstOrThrow({
		where: { deckId: a.id },
		select: { noticeId: true },
	})
	expect(
		await answerNotice(borrower.id, notice.noticeId!, 'ask-again'),
	).toMatchObject({ status: 400 })
	expect(await corroderLoans(a.id)).toEqual(['revoked:1'])
	await answerNotice(borrower.id, notice.noticeId!, 'accept')
	expect(await corroderLoans(a.id)).toEqual([])
})
