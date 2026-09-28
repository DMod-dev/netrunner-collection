import * as E from 'react-email'
import { type BorrowNotification } from './borrowing.server.ts'
import { displayName } from './borrowing.ts'
import { prisma } from './db.server.ts'
import { sendEmail } from './email.server.ts'

function copies(n: number) {
	return `${n} ${n === 1 ? 'card' : 'cards'}`
}

/** Subject and body of each borrowing email; `from` is the other user. */
function describe(kind: BorrowNotification['kind'], from: string, n: number) {
	switch (kind) {
		case 'requested':
			return {
				subject: `${from} would like to borrow cards from your collection`,
				body: `${from} asked to borrow ${copies(n)} from your collection for their decks. Approve or reject the request on your Borrowing page.`,
			}
		case 'approved':
			return {
				subject: `${from} lent you the cards you asked for`,
				body: `${from} approved your request: ${copies(n)} from their collection are now in your decks.`,
			}
		case 'rejected':
			return {
				subject: `${from} didn’t lend you the cards you asked for`,
				body: `${from} rejected your request for ${copies(n)}. Accept that, or ask again, on your Borrowing page.`,
			}
		case 'revoked':
			return {
				subject: `${from} took back cards they lent you`,
				body: `${from} took back ${copies(n)} they lent you. Accept that, or ask again, on your Borrowing page.`,
			}
		case 'share-ended':
			return {
				subject: `${from} stopped sharing their collection with you`,
				body: `${from} no longer shares their collection with you, so the ${copies(n)} you borrowed or asked for aren’t lent to you any more.`,
			}
	}
}

function BorrowingEmail({
	heading,
	body,
	url,
}: {
	heading: string
	body: string
	url: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>{heading}</E.Text>
				</h1>
				<p>
					<E.Text>{body}</E.Text>
				</p>
				<E.Link href={url}>{url}</E.Link>
			</E.Container>
		</E.Html>
	)
}

/**
 * Email each notification's recipient. A failure is logged, never thrown:
 * the change is already saved and the Borrowing page shows it either way.
 */
export async function sendBorrowNotifications(
	notifications: BorrowNotification[],
	origin: string,
) {
	if (notifications.length === 0) return
	try {
		const ids = [
			...new Set(notifications.flatMap((n) => [n.toUserId, n.fromUserId])),
		]
		const users = new Map(
			(
				await prisma.user.findMany({
					where: { id: { in: ids } },
					select: { id: true, email: true, username: true, name: true },
				})
			).map((u) => [u.id, u]),
		)
		const url = `${origin}/borrowing`
		await Promise.all(
			notifications.map(async (notification) => {
				const to = users.get(notification.toUserId)
				const from = users.get(notification.fromUserId)
				if (!to || !from) return
				const { subject, body } = describe(
					notification.kind,
					displayName(from),
					notification.copies,
				)
				const result = await sendEmail({
					to: to.email,
					subject,
					react: <BorrowingEmail heading={subject} body={body} url={url} />,
				})
				if (result.status === 'error') {
					console.error('Borrowing email failed', result.error)
				}
			}),
		)
	} catch (error) {
		console.error('Borrowing email failed', error)
	}
}
