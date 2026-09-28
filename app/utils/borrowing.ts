// Borrowing cards from a collection shared with you, for your decks.
// Client-safe; the reads and writes are in borrowing.server.ts.

/**
 * - pending: asked for; the lender's copies are held until they answer
 * - approved: lent
 * - rejected: the lender said no to the request
 * - revoked: the lender took approved copies back
 *
 * Rejected and revoked copies stay in the deck, marked, until the borrower
 * accepts that (they become plain copies) or asks again (pending again).
 */
export type LoanStatus = 'pending' | 'approved' | 'rejected' | 'revoked'

export const ACTIVE_LOAN_STATUSES = ['pending', 'approved'] as const
export const NOT_LENT_STATUSES = ['rejected', 'revoked'] as const

export function isLoanStatus(value: string): value is LoanStatus {
	return (
		value === 'pending' ||
		value === 'approved' ||
		value === 'rejected' ||
		value === 'revoked'
	)
}

export type BorrowUser = { id: string; username: string; name: string | null }

export function displayName(user: { username: string; name: string | null }) {
	return user.name ?? user.username
}

/** A deck card's copies borrowed from one lender, in one state. */
export type CardLoan = {
	lenderId: string
	lenderName: string
	status: LoanStatus
	quantity: number
	/** rejected/revoked copies: the notice they're answered through */
	noticeId: string | null
}

/** A collection shared with the deck's owner, and what it can lend the deck. */
export type DeckLender = {
	id: string
	username: string
	name: string
	/** per card in the deck: copies the lender has free to lend */
	available: Record<string, number>
}

/**
 * Something waiting on the user, for the notification bell: a request to
 * lend (approve or reject) or copies not lent (accept or ask again).
 */
export type BorrowingNotification =
	| {
			kind: 'request'
			requestId: string
			borrowerName: string
			copies: number
			date: Date | string
	  }
	| {
			kind: 'notice'
			noticeId: string
			status: 'rejected' | 'revoked'
			lenderName: string
			copies: number
			/** false once the lender stopped sharing: accepting is all that's left */
			canAskAgain: boolean
			date: Date | string
	  }

/** Copies of a card borrowed from each lender, summed per state. */
export function loanTotals(loans: CardLoan[]) {
	let approved = 0
	let pending = 0
	let notLent = 0
	for (const loan of loans) {
		if (loan.status === 'approved') approved += loan.quantity
		else if (loan.status === 'pending') pending += loan.quantity
		else notLent += loan.quantity
	}
	return { approved, pending, notLent, all: approved + pending + notLent }
}

/** Copies from one lender that count as borrowed (approved or asked for). */
export function borrowedFrom(loans: CardLoan[], lenderId: string) {
	return loans.reduce(
		(n, loan) =>
			loan.lenderId === lenderId &&
			(loan.status === 'approved' || loan.status === 'pending')
				? n + loan.quantity
				: n,
		0,
	)
}
