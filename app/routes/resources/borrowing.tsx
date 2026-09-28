import { data } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { sendBorrowNotifications } from '#app/utils/borrowing-email.server.tsx'
import {
	answerNotice,
	cancelRequest,
	respondToRequest,
	revokeCard,
} from '#app/utils/borrowing.server.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { type Route } from './+types/borrowing.ts'

export const BORROWING_ACTION_PATH = '/resources/borrowing'

const BorrowingActionSchema = z.discriminatedUnion('intent', [
	// the lender answers a pending request as a whole
	z.object({ intent: z.literal('approve'), requestId: z.string().min(1) }),
	z.object({ intent: z.literal('reject'), requestId: z.string().min(1) }),
	// the lender takes back a card's lent copies, from one borrower or all
	z.object({
		intent: z.literal('revoke'),
		cardId: z.string().min(1),
		borrowerId: z.string().optional(),
	}),
	// the borrower withdraws a pending request
	z.object({ intent: z.literal('cancel'), requestId: z.string().min(1) }),
	// the borrower answers rejected or revoked copies, in one deck or all
	z.object({
		intent: z.literal('answer-notice'),
		noticeId: z.string().min(1),
		answer: z.enum(['accept', 'ask-again']),
		deckId: z.string().optional(),
	}),
])

function cards(n: number) {
	return `${n} ${n === 1 ? 'card' : 'cards'}`
}

function refused(error: string, status = 400) {
	return data({ ok: false, error } as const, { status })
}

async function done(
	description: string,
	type: 'success' | 'message' = 'success',
) {
	return data({ ok: true } as const, {
		headers: await createToastHeaders({ type, description }),
	})
}

export async function action({ request }: Route.ActionArgs) {
	// Every write is scoped to the caller's side of the request: the lender
	// answers and revokes, the borrower cancels and answers notices.
	const userId = await requireUserId(request)
	await ensurePrimary()
	const parsed = BorrowingActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return refused(parsed.error.issues[0]?.message ?? 'Invalid')
	}
	const origin = getDomainUrl(request)
	const submission = parsed.data
	switch (submission.intent) {
		case 'approve':
		case 'reject': {
			const answer = submission.intent
			const result = await respondToRequest(
				userId,
				submission.requestId,
				answer,
			)
			if (!result) return refused('That request is no longer pending', 404)
			await sendBorrowNotifications(result.notifications, origin)
			return done(
				answer === 'approve'
					? `Lent ${cards(result.copies)}`
					: `Rejected the request for ${cards(result.copies)}`,
			)
		}
		case 'revoke': {
			const result = await revokeCard(
				userId,
				submission.cardId,
				submission.borrowerId || undefined,
			)
			if (result.copies === 0) return refused('Nothing to take back', 404)
			await sendBorrowNotifications(result.notifications, origin)
			return done(`Took back ${cards(result.copies)}`)
		}
		case 'cancel': {
			if (!(await cancelRequest(userId, submission.requestId))) {
				return refused('That request is no longer pending', 404)
			}
			return done('Withdrew your request')
		}
		case 'answer-notice': {
			const result = await answerNotice(
				userId,
				submission.noticeId,
				submission.answer,
				submission.deckId || undefined,
			)
			if (!result) return refused('Nothing left to answer', 404)
			if ('error' in result) return refused(result.error, result.status)
			await sendBorrowNotifications(result.notifications, origin)
			if (submission.answer === 'accept') {
				return done(`${cards(result.answered)} no longer borrowed`)
			}
			return result.asked === result.answered
				? done(`Asked again for ${cards(result.asked)}`)
				: done(
						result.asked === 0
							? 'None of those cards are free to borrow now'
							: `Asked again for ${result.asked} of ${cards(result.answered)}; the rest aren’t free now`,
						'message',
					)
		}
	}
}

/** Report a failed change like any other, rather than the error boundary. */
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
	try {
		return await serverAction()
	} catch (error) {
		if (error instanceof Response) throw error
		return {
			ok: false,
			error: 'Couldn’t save your change. Please try again.',
		} as const
	}
}
