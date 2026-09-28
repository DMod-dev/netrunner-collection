import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '@prisma/client'
import {
	ACTIVE_LOAN_STATUSES,
	type BorrowingNotification,
	type BorrowUser,
	type CardLoan,
	type DeckLender,
	displayName,
	isLoanStatus,
	NOT_LENT_STATUSES,
} from './borrowing.ts'
import { prisma } from './db.server.ts'
import { getAvailability } from './deck-fill.server.ts'
import { cancelEmptyRequests, getLoanedCounts } from './deck-loans.server.ts'

// Borrowing: filling a deck with copies from a collection shared with you.
//
// A borrower asks a lender (who shares their collection with them) for
// copies through a BorrowRequest; each deck card's copies are a DeckLoan row.
// There's at most one pending request per borrower and lender, and borrowing
// more from that lender adds to it. Pending and approved copies are held
// from the lender's own decks and from other borrowers (getAvailability
// counts them). The lender approves or rejects a request as a whole, and can
// take approved copies of a card back (revoke). Rejected and revoked copies
// stay in the borrower's deck until they accept that or ask again.
//
// Writes return the emails to send (BorrowNotification); the routes send
// them after the change is saved (borrowing-email.server.tsx).

type Db = Prisma.TransactionClient

const userSelect = { id: true, username: true, name: true } as const

/** An email to send once a borrowing change is saved. */
export type BorrowNotification = {
	kind:
		| 'requested'
		| 'approved'
		| 'rejected'
		| 'revoked'
		| 'share-ended'
		| 'share-left'
	/** who the email goes to */
	toUserId: string
	/** the other side */
	fromUserId: string
	copies: number
}

/** Why a borrowing write was refused, for the action to report. */
export type BorrowError = { error: string; status: 400 | 404 }

const notShared: BorrowError = {
	error: 'That collection isn’t shared with you',
	status: 400,
}

/** Users who share their collection with `borrowerId`, oldest share first. */
export async function listLenders(
	borrowerId: string,
	db: Db = prisma,
): Promise<BorrowUser[]> {
	const shares = await db.collectionShare.findMany({
		where: { viewerId: borrowerId },
		orderBy: { createdAt: 'asc' },
		select: { owner: { select: userSelect } },
	})
	return shares.map((share) => share.owner)
}

async function isSharedWith(db: Db, lenderId: string, borrowerId: string) {
	const share = await db.collectionShare.findUnique({
		where: { ownerId_viewerId: { ownerId: lenderId, viewerId: borrowerId } },
		select: { id: true },
	})
	return share !== null
}

/**
 * The borrower's pending request to the lender, or a new one. `created` says
 * whether the lender needs telling.
 */
async function openRequest(db: Db, borrowerId: string, lenderId: string) {
	// the unique pendingKey means a second, concurrent create fails rather
	// than opening a second request
	const pendingKey = `${borrowerId}:${lenderId}`
	const existing = await db.borrowRequest.findUnique({
		where: { pendingKey },
		select: { id: true },
	})
	if (existing) {
		// bump updatedAt: the lender sees when it last grew
		await db.borrowRequest.update({
			where: { id: existing.id },
			data: { updatedAt: new Date() },
			select: { id: true },
		})
		return { id: existing.id, created: false }
	}
	const request = await db.borrowRequest.create({
		data: { borrowerId, lenderId, pendingKey },
		select: { id: true },
	})
	return { id: request.id, created: true }
}

function addPending(
	db: Db,
	requestId: string,
	deckId: string,
	cardId: string,
	quantity: number,
) {
	return db.deckLoan.upsert({
		where: {
			requestId_deckId_cardId_status: {
				requestId,
				deckId,
				cardId,
				status: 'pending',
			},
		},
		create: { requestId, deckId, cardId, quantity, status: 'pending' },
		update: { quantity: { increment: quantity } },
		select: { id: true },
	})
}

/** The deck's cards, the identity as one copy, if `userId` owns it. */
async function findDeckRows(db: Db, userId: string, deckId: string) {
	const deck = await db.deck.findFirst({
		where: { id: deckId, userId },
		select: {
			identityCardId: true,
			identityFromCollection: true,
			cards: { select: { cardId: true, quantity: true, fromCollection: true } },
		},
	})
	if (!deck) return null
	return [
		...deck.cards,
		...(deck.identityCardId
			? [
					{
						cardId: deck.identityCardId,
						quantity: 1,
						fromCollection: deck.identityFromCollection,
					},
				]
			: []),
	]
}

function requested(
	request: { id: string; created: boolean } | null,
	borrowerId: string,
	lenderId: string,
	copies: number,
): BorrowNotification[] {
	return request?.created
		? [
				{
					kind: 'requested',
					toUserId: lenderId,
					fromUserId: borrowerId,
					copies,
				},
			]
		: []
}

// ---------------------------------------------------------------------------
// Borrower
// ---------------------------------------------------------------------------

export type BorrowFillReport = {
	/** copies asked for this time */
	asked: number
	/** copies the deck had no source for before */
	open: number
	notifications: BorrowNotification[]
}

/**
 * "Fill from <lender>'s collection": ask for every copy the deck plays that
 * isn't from the owner's collection or borrowed already, as far as the
 * lender has copies free. It only ever adds to the open request. Returns
 * null if the user doesn't own the deck.
 */
export async function fillFromLender(
	borrowerId: string,
	deckId: string,
	lenderId: string,
): Promise<BorrowFillReport | BorrowError | null> {
	return prisma.$transaction(async (tx) => {
		const rows = await findDeckRows(tx, borrowerId, deckId)
		if (!rows) return null
		if (!(await isSharedWith(tx, lenderId, borrowerId))) return notShared
		const loaned = await getLoanedCounts(tx, deckId)
		const gaps = rows
			.map((row) => ({
				cardId: row.cardId,
				open: row.quantity - row.fromCollection - (loaned.get(row.cardId) ?? 0),
			}))
			.filter((row) => row.open > 0)
		const open = gaps.reduce((n, row) => n + row.open, 0)
		if (open === 0) return { asked: 0, open, notifications: [] }

		const availability = await getAvailability(
			lenderId,
			gaps.map((row) => row.cardId),
			null,
			tx,
		)
		let request: { id: string; created: boolean } | null = null
		let asked = 0
		for (const row of gaps) {
			const take = Math.min(
				row.open,
				availability.get(row.cardId)?.available ?? 0,
			)
			if (take === 0) continue
			request ??= await openRequest(tx, borrowerId, lenderId)
			await addPending(tx, request.id, deckId, row.cardId, take)
			asked += take
		}
		return {
			asked,
			open,
			notifications: requested(request, borrowerId, lenderId, asked),
		}
	})
}

/**
 * Set how many of one card's copies the deck borrows from a lender (asked
 * for or lent). More adds to the open request, as far as the deck has
 * copies without a source and the lender has copies free; fewer takes back
 * copies still asked for first, then gives lent ones back. Returns null if
 * the user doesn't own the deck.
 */
export async function setBorrowed(
	borrowerId: string,
	deckId: string,
	cardId: string,
	lenderId: string,
	borrowed: number,
): Promise<
	{ borrowed: number; notifications: BorrowNotification[] } | BorrowError | null
> {
	return prisma.$transaction(async (tx) => {
		const rows = await findDeckRows(tx, borrowerId, deckId)
		if (!rows) return null
		const row = rows.find((r) => r.cardId === cardId)
		if (!row) return { error: 'That card isn’t in this deck', status: 400 }
		const loans = await tx.deckLoan.findMany({
			where: {
				deckId,
				cardId,
				status: { in: [...ACTIVE_LOAN_STATUSES] },
				request: { lenderId },
			},
			select: { id: true, quantity: true, status: true, createdAt: true },
		})
		const current = loans.reduce((n, l) => n + l.quantity, 0)
		const target = Math.max(0, Math.trunc(borrowed))

		if (target > current) {
			if (!(await isSharedWith(tx, lenderId, borrowerId))) return notShared
			const loaned = (await getLoanedCounts(tx, deckId)).get(cardId) ?? 0
			const open = row.quantity - row.fromCollection - loaned
			const free =
				(await getAvailability(lenderId, [cardId], null, tx)).get(cardId)
					?.available ?? 0
			const add = Math.max(0, Math.min(target - current, open, free))
			if (add === 0) return { borrowed: current, notifications: [] }
			const request = await openRequest(tx, borrowerId, lenderId)
			await addPending(tx, request.id, deckId, cardId, add)
			return {
				borrowed: current + add,
				notifications: requested(request, borrowerId, lenderId, add),
			}
		}

		let excess = current - target
		// copies still asked for go first, then the newest lent ones
		loans.sort(
			(a, b) =>
				Number(a.status === 'approved') - Number(b.status === 'approved') ||
				b.createdAt.getTime() - a.createdAt.getTime(),
		)
		for (const loan of loans) {
			if (excess <= 0) break
			const drop = Math.min(excess, loan.quantity)
			excess -= drop
			if (drop === loan.quantity) {
				await tx.deckLoan.delete({ where: { id: loan.id } })
			} else {
				await tx.deckLoan.update({
					where: { id: loan.id },
					data: { quantity: loan.quantity - drop },
				})
			}
		}
		await cancelEmptyRequests(tx, borrowerId)
		return { borrowed: target, notifications: [] }
	})
}

/**
 * Give back every copy the deck borrows from a lender, or asked them for.
 * Copies marked not lent stay until they're answered. Returns how many, or
 * null if the user doesn't own the deck.
 */
export async function returnToLender(
	borrowerId: string,
	deckId: string,
	lenderId: string,
) {
	return prisma.$transaction(async (tx) => {
		const deck = await tx.deck.findFirst({
			where: { id: deckId, userId: borrowerId },
			select: { id: true },
		})
		if (!deck) return null
		const where = {
			deckId,
			status: { in: [...ACTIVE_LOAN_STATUSES] },
			request: { lenderId },
		}
		const { _sum } = await tx.deckLoan.aggregate({
			where,
			_sum: { quantity: true },
		})
		await tx.deckLoan.deleteMany({ where })
		await cancelEmptyRequests(tx, borrowerId)
		return { returned: _sum.quantity ?? 0 }
	})
}

/**
 * Withdraw a pending request: its copies become plain copies in their decks.
 * Returns false if it isn't the borrower's pending request.
 */
export async function cancelRequest(borrowerId: string, requestId: string) {
	return prisma.$transaction(async (tx) => {
		const { count } = await tx.borrowRequest.updateMany({
			where: { id: requestId, borrowerId, status: 'pending' },
			data: { status: 'cancelled', respondedAt: new Date(), pendingKey: null },
		})
		if (count === 0) return false
		await tx.deckLoan.deleteMany({ where: { requestId, status: 'pending' } })
		return true
	})
}

export type NoticeAnswer = 'accept' | 'ask-again'

/**
 * Answer copies the lender rejected or revoked: accept it (they become plain
 * copies in their decks) or ask again (they're added to the open request, as
 * far as the lender has copies free; the rest become plain copies). With
 * `deckId`, only that deck's copies are answered. Returns null if there's
 * nothing to answer.
 */
export async function answerNotice(
	borrowerId: string,
	noticeId: string,
	answer: NoticeAnswer,
	deckId?: string,
): Promise<
	| { answered: number; asked: number; notifications: BorrowNotification[] }
	| BorrowError
	| null
> {
	return prisma
		.$transaction(async (tx) => {
			const rows = await tx.deckLoan.findMany({
				where: {
					noticeId,
					status: { in: [...NOT_LENT_STATUSES] },
					request: { borrowerId },
					...(deckId ? { deckId } : {}),
				},
				orderBy: { createdAt: 'asc' },
				select: {
					id: true,
					deckId: true,
					cardId: true,
					quantity: true,
					request: { select: { lenderId: true } },
				},
			})
			const first = rows[0]
			if (!first) return null
			const answered = rows.reduce((n, r) => n + r.quantity, 0)
			await tx.deckLoan.deleteMany({
				where: { id: { in: rows.map((r) => r.id) } },
			})
			if (answer === 'accept') return { answered, asked: 0, notifications: [] }

			// a notice's copies all come from one lender
			const { lenderId } = first.request
			if (!(await isSharedWith(tx, lenderId, borrowerId))) {
				throw new NoticeRefused(
					'They no longer share their collection with you',
				)
			}
			const availability = await getAvailability(
				lenderId,
				rows.map((r) => r.cardId),
				null,
				tx,
			)
			const free = new Map(
				[...availability].map(([cardId, a]) => [cardId, a.available]),
			)
			let request: { id: string; created: boolean } | null = null
			let asked = 0
			for (const row of rows) {
				const take = Math.min(row.quantity, free.get(row.cardId) ?? 0)
				if (take === 0) continue
				free.set(row.cardId, (free.get(row.cardId) ?? 0) - take)
				request ??= await openRequest(tx, borrowerId, lenderId)
				await addPending(tx, request.id, row.deckId, row.cardId, take)
				asked += take
			}
			return {
				answered,
				asked,
				notifications: requested(request, borrowerId, lenderId, asked),
			}
		})
		.catch((error: unknown) => {
			// thrown so the transaction rolls back and the copies stay marked
			if (error instanceof NoticeRefused) {
				return { error: error.message, status: 400 } as const
			}
			throw error
		})
}

class NoticeRefused extends Error {}

// ---------------------------------------------------------------------------
// Lender
// ---------------------------------------------------------------------------

/**
 * Approve or reject a pending request to `lenderId` as a whole. Approved
 * copies are lent; rejected ones are marked not lent in the borrower's decks
 * until they answer. Returns null if it isn't the lender's pending request.
 */
export async function respondToRequest(
	lenderId: string,
	requestId: string,
	answer: 'approve' | 'reject',
) {
	return prisma.$transaction(async (tx) => {
		const request = await tx.borrowRequest.findFirst({
			where: { id: requestId, lenderId, status: 'pending' },
			select: { id: true, borrowerId: true },
		})
		if (!request) return null
		const { _sum } = await tx.deckLoan.aggregate({
			where: { requestId, status: 'pending' },
			_sum: { quantity: true },
		})
		const copies = _sum.quantity ?? 0
		const approve = answer === 'approve'
		await tx.deckLoan.updateMany({
			where: { requestId, status: 'pending' },
			data: approve
				? { status: 'approved' }
				: { status: 'rejected', noticeId: requestId },
		})
		await tx.borrowRequest.update({
			where: { id: requestId },
			data: {
				status: approve ? 'approved' : 'rejected',
				respondedAt: new Date(),
				pendingKey: null,
			},
		})
		return {
			copies,
			notifications: [
				{
					kind: approve ? 'approved' : 'rejected',
					toUserId: request.borrowerId,
					fromUserId: lenderId,
					copies,
				},
			] satisfies BorrowNotification[],
		}
	})
}

/**
 * Take back every lent copy of a card, from one borrower or (without
 * `borrowerId`) everyone. The copies are free again at once; the borrower's
 * decks mark them revoked until they answer. Returns how many copies.
 */
export async function revokeCard(
	lenderId: string,
	cardId: string,
	borrowerId?: string,
) {
	return prisma.$transaction(async (tx) => {
		const rows = await tx.deckLoan.findMany({
			where: {
				cardId,
				status: 'approved',
				request: { lenderId, ...(borrowerId ? { borrowerId } : {}) },
			},
			select: {
				id: true,
				quantity: true,
				request: { select: { borrowerId: true } },
			},
		})
		const notifications = await revokeRows(tx, lenderId, rows)
		return { copies: sumQuantity(rows), notifications }
	})
}

/** Mark approved rows revoked, one notice per borrower. */
async function revokeRows(
	db: Db,
	lenderId: string,
	rows: Array<{
		id: string
		quantity: number
		request: { borrowerId: string }
	}>,
) {
	const byBorrower = new Map<string, typeof rows>()
	for (const row of rows) {
		const list = byBorrower.get(row.request.borrowerId)
		if (list) list.push(row)
		else byBorrower.set(row.request.borrowerId, [row])
	}
	const notifications: BorrowNotification[] = []
	for (const [borrowerId, list] of byBorrower) {
		const noticeId = createId()
		await db.deckLoan.updateMany({
			where: { id: { in: list.map((r) => r.id) } },
			data: { status: 'revoked', noticeId },
		})
		notifications.push({
			kind: 'revoked',
			toUserId: borrowerId,
			fromUserId: lenderId,
			copies: list.reduce((n, r) => n + r.quantity, 0),
		})
	}
	return notifications
}

/**
 * The share from `lenderId` to `borrowerId` is gone. If the lender ended it,
 * every lent copy is revoked and every pending request rejected: the
 * borrower can only accept those (asking again needs the share), and gets
 * an email. If the borrower left, they chose to: their borrowed and
 * asked-for copies simply go back, and the lender is told what came back.
 * Returns the emails to send and how many copies were lent and asked for.
 */
export async function endLoans(
	db: Db,
	lenderId: string,
	borrowerId: string,
	endedBy: 'lender' | 'borrower',
): Promise<{
	notifications: BorrowNotification[]
	lent: number
	asked: number
}> {
	const between = { request: { lenderId, borrowerId } }
	const [approved, pendingRows, requests] = await Promise.all([
		db.deckLoan.findMany({
			where: { status: 'approved', ...between },
			select: {
				id: true,
				quantity: true,
				request: { select: { borrowerId: true } },
			},
		}),
		db.deckLoan.findMany({
			where: { status: 'pending', ...between },
			select: { quantity: true },
		}),
		db.borrowRequest.findMany({
			where: { lenderId, borrowerId, status: 'pending' },
			select: { id: true },
		}),
	])
	const lent = sumQuantity(approved)
	const asked = sumQuantity(pendingRows)
	const closed = { respondedAt: new Date(), pendingKey: null }

	if (endedBy === 'borrower') {
		await db.deckLoan.deleteMany({
			where: { status: { in: [...ACTIVE_LOAN_STATUSES] }, ...between },
		})
		await db.borrowRequest.updateMany({
			where: { id: { in: requests.map((r) => r.id) } },
			data: { status: 'cancelled', ...closed },
		})
		return {
			lent,
			asked,
			notifications:
				lent > 0
					? [
							{
								kind: 'share-left',
								toUserId: lenderId,
								fromUserId: borrowerId,
								copies: lent,
							},
						]
					: [],
		}
	}

	await revokeRows(db, lenderId, approved)
	for (const { id } of requests) {
		await db.deckLoan.updateMany({
			where: { requestId: id, status: 'pending' },
			data: { status: 'rejected', noticeId: id },
		})
		await db.borrowRequest.update({
			where: { id },
			data: { status: 'rejected', ...closed },
		})
	}
	return {
		lent,
		asked,
		notifications:
			lent + asked > 0
				? [
						{
							kind: 'share-ended',
							toUserId: borrowerId,
							fromUserId: lenderId,
							copies: lent + asked,
						},
					]
				: [],
	}
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * What's waiting on the user, oldest first, for the notification bell:
 * pending requests to lend, and copies a lender didn't lend or took back.
 */
export async function getBorrowingNotifications(
	userId: string,
): Promise<BorrowingNotification[]> {
	const [requests, notices] = await Promise.all([
		prisma.borrowRequest.findMany({
			where: {
				lenderId: userId,
				status: 'pending',
				loans: { some: { status: 'pending' } },
			},
			select: {
				id: true,
				updatedAt: true,
				borrower: { select: userSelect },
				loans: { where: { status: 'pending' }, select: { quantity: true } },
			},
		}),
		loadNotices(userId),
	])
	return [
		...requests.map((r): BorrowingNotification => ({
			kind: 'request',
			requestId: r.id,
			borrowerName: displayName(r.borrower),
			copies: sumQuantity(r.loans),
			date: r.updatedAt,
		})),
		...notices.map((n): BorrowingNotification => ({
			kind: 'notice',
			noticeId: n.noticeId,
			status: n.status,
			lenderName: displayName(n.lender),
			copies: sumQuantity(n.rows),
			canAskAgain: n.canAskAgain,
			date: n.date,
		})),
	].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

/**
 * What the builder shows about borrowing for a deck: the collections shared
 * with its owner and what each has free for its cards, and its cards' loans.
 */
export async function getDeckBorrowing(
	borrowerId: string,
	deck: {
		id: string
		identity: { id: string } | null
		cards: Array<{ card: { id: string } }>
	},
) {
	const cardIds = [
		...deck.cards.map((c) => c.card.id),
		...(deck.identity ? [deck.identity.id] : []),
	]
	const [lenders, rows] = await Promise.all([
		listLenders(borrowerId),
		prisma.deckLoan.findMany({
			where: { deckId: deck.id },
			orderBy: { createdAt: 'asc' },
			select: {
				cardId: true,
				quantity: true,
				status: true,
				noticeId: true,
				request: { select: { lender: { select: userSelect } } },
			},
		}),
	])
	const lenderAvailability = await Promise.all(
		lenders.map(async (lender): Promise<DeckLender> => {
			const map = await getAvailability(lender.id, cardIds, null)
			return {
				id: lender.id,
				username: lender.username,
				name: displayName(lender),
				available: Object.fromEntries(
					[...map].map(([cardId, a]) => [cardId, a.available]),
				),
			}
		}),
	)

	const loans: Record<string, CardLoan[]> = {}
	for (const row of rows) {
		if (!isLoanStatus(row.status)) continue
		const { lender } = row.request
		const list = (loans[row.cardId] ??= [])
		const same = list.find(
			(l) =>
				l.lenderId === lender.id &&
				l.status === row.status &&
				l.noticeId === row.noticeId,
		)
		if (same) same.quantity += row.quantity
		else {
			list.push({
				lenderId: lender.id,
				lenderName: displayName(lender),
				status: row.status,
				quantity: row.quantity,
				noticeId: row.noticeId,
			})
		}
	}
	return {
		lenders: lenderAvailability,
		loans,
	}
}

export type DeckBorrowing = Awaited<ReturnType<typeof getDeckBorrowing>>

/** Copies of a card lent (or asked for), per borrower. */
export type CardLending = Array<{
	borrower: BorrowUser
	lent: number
	asked: number
}>

/**
 * Copies of each card the user lends, or has been asked for, per borrower,
 * for their collection pages. Cards nobody borrows are left out.
 */
export async function getCopiesLent(userId: string, cardIds: string[]) {
	const lent = new Map<string, CardLending>()
	if (cardIds.length === 0) return lent
	const rows = await prisma.deckLoan.findMany({
		where: {
			cardId: { in: cardIds },
			status: { in: [...ACTIVE_LOAN_STATUSES] },
			request: { lenderId: userId },
		},
		select: {
			cardId: true,
			quantity: true,
			status: true,
			request: { select: { borrower: { select: userSelect } } },
		},
	})
	for (const row of rows) {
		const { borrower } = row.request
		const list = lent.get(row.cardId) ?? []
		let entry = list.find((e) => e.borrower.id === borrower.id)
		if (!entry) {
			entry = { borrower, lent: 0, asked: 0 }
			list.push(entry)
		}
		if (row.status === 'approved') entry.lent += row.quantity
		else entry.asked += row.quantity
		lent.set(row.cardId, list)
	}
	for (const list of lent.values()) {
		list.sort((a, b) =>
			displayName(a.borrower).localeCompare(displayName(b.borrower)),
		)
	}
	return lent
}

const loanPageSelect = {
	id: true,
	quantity: true,
	status: true,
	noticeId: true,
	deck: { select: { id: true, name: true } },
	card: { select: { id: true, title: true } },
} satisfies Prisma.DeckLoanSelect

type LoanPageRow = Prisma.DeckLoanGetPayload<{ select: typeof loanPageSelect }>

/** Copies per card, over every deck (the lender doesn't see deck names). */
function cardTotals(rows: LoanPageRow[]) {
	const byCard = new Map<
		string,
		{ cardId: string; title: string; quantity: number }
	>()
	for (const row of rows) {
		const entry = byCard.get(row.card.id)
		if (entry) entry.quantity += row.quantity
		else {
			byCard.set(row.card.id, {
				cardId: row.card.id,
				title: row.card.title,
				quantity: row.quantity,
			})
		}
	}
	return [...byCard.values()].sort((a, b) => a.title.localeCompare(b.title))
}

/** Copies per card and deck, for the borrower (their own decks). */
function deckCardRows(rows: LoanPageRow[]) {
	return rows
		.map((row) => ({
			cardId: row.card.id,
			title: row.card.title,
			deckId: row.deck.id,
			deckName: row.deck.name,
			quantity: row.quantity,
		}))
		.sort(
			(a, b) =>
				a.title.localeCompare(b.title) || a.deckName.localeCompare(b.deckName),
		)
}

function sumQuantity(rows: Array<{ quantity: number }>) {
	return rows.reduce((n, r) => n + r.quantity, 0)
}

/**
 * Copies lenders rejected or took back, waiting for `userId` to answer,
 * grouped into notices (one per rejection or revocation), oldest first.
 * Whether they can still ask again needs the shares, which are only looked
 * up when there's a notice: the bell runs this on every page.
 */
async function loadNotices(userId: string) {
	const rows = await prisma.deckLoan.findMany({
		where: {
			status: { in: [...NOT_LENT_STATUSES] },
			request: { borrowerId: userId },
		},
		orderBy: { updatedAt: 'asc' },
		select: {
			...loanPageSelect,
			updatedAt: true,
			request: { select: { lender: { select: userSelect } } },
		},
	})
	if (rows.length === 0) return []
	const sharing = new Set((await listLenders(userId)).map((l) => l.id))
	const notices = new Map<
		string,
		{
			noticeId: string
			status: 'rejected' | 'revoked'
			lender: BorrowUser
			canAskAgain: boolean
			date: Date
			rows: LoanPageRow[]
		}
	>()
	for (const row of rows) {
		if (!row.noticeId) continue
		const notice = notices.get(row.noticeId) ?? {
			noticeId: row.noticeId,
			status: row.status === 'revoked' ? 'revoked' : 'rejected',
			lender: row.request.lender,
			canAskAgain: sharing.has(row.request.lender.id),
			date: row.updatedAt,
			rows: [],
		}
		notice.rows.push(row)
		notices.set(row.noticeId, notice)
	}
	return [...notices.values()]
}

/** Everything the Borrowing page shows, both as borrower and as lender. */
export async function getBorrowingOverview(userId: string) {
	const [incoming, outgoing, notices, lentRows, borrowedRows] =
		await Promise.all([
			prisma.borrowRequest.findMany({
				where: { lenderId: userId, status: 'pending' },
				orderBy: { createdAt: 'asc' },
				select: {
					id: true,
					createdAt: true,
					updatedAt: true,
					borrower: { select: userSelect },
					loans: { where: { status: 'pending' }, select: loanPageSelect },
				},
			}),
			prisma.borrowRequest.findMany({
				where: { borrowerId: userId, status: 'pending' },
				orderBy: { createdAt: 'asc' },
				select: {
					id: true,
					createdAt: true,
					lender: { select: userSelect },
					loans: { where: { status: 'pending' }, select: loanPageSelect },
				},
			}),
			loadNotices(userId),
			prisma.deckLoan.findMany({
				where: { status: 'approved', request: { lenderId: userId } },
				select: {
					...loanPageSelect,
					request: { select: { borrower: { select: userSelect } } },
				},
			}),
			prisma.deckLoan.findMany({
				where: { status: 'approved', request: { borrowerId: userId } },
				select: {
					...loanPageSelect,
					request: { select: { lender: { select: userSelect } } },
				},
			}),
		])

	const byUser = <Row extends LoanPageRow>(
		rows: Row[],
		userOf: (row: Row) => BorrowUser,
	) => {
		const groups = new Map<string, { user: BorrowUser; rows: Row[] }>()
		for (const row of rows) {
			const user = userOf(row)
			const group = groups.get(user.id)
			if (group) group.rows.push(row)
			else groups.set(user.id, { user, rows: [row] })
		}
		return [...groups.values()].sort((a, b) =>
			displayName(a.user).localeCompare(displayName(b.user)),
		)
	}

	return {
		incoming: incoming
			.filter((r) => r.loans.length > 0)
			.map((r) => ({
				id: r.id,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
				borrower: r.borrower,
				copies: sumQuantity(r.loans),
				cards: cardTotals(r.loans),
			})),
		outgoing: outgoing
			.filter((r) => r.loans.length > 0)
			.map((r) => ({
				id: r.id,
				createdAt: r.createdAt,
				lender: r.lender,
				copies: sumQuantity(r.loans),
				cards: deckCardRows(r.loans),
			})),
		notices: notices.map(({ rows, ...notice }) => ({
			...notice,
			copies: sumQuantity(rows),
			cards: deckCardRows(rows),
		})),
		lent: byUser(lentRows, (r) => r.request.borrower).map(({ user, rows }) => ({
			borrower: user,
			copies: sumQuantity(rows),
			cards: cardTotals(rows),
		})),
		borrowed: byUser(borrowedRows, (r) => r.request.lender).map(
			({ user, rows }) => ({
				lender: user,
				copies: sumQuantity(rows),
				cards: deckCardRows(rows),
			}),
		),
	}
}

export type BorrowingOverview = Awaited<ReturnType<typeof getBorrowingOverview>>
