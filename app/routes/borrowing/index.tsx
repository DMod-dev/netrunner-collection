import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { BorrowingActionButton } from '#app/components/borrowing-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { UserIcon } from '#app/components/user-icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	type BorrowingOverview,
	getBorrowingOverview,
} from '#app/utils/borrowing.server.ts'
import { displayName } from '#app/utils/borrowing.ts'
import { formatDate } from '#app/utils/dates.ts'
import { pageTitle } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	return { overview: await getBorrowingOverview(userId) }
}

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Borrowing') },
]

function cards(n: number) {
	return `${n} ${n === 1 ? 'card' : 'cards'}`
}

export default function BorrowingRoute({ loaderData }: Route.ComponentProps) {
	const { incoming, outgoing, notices, lent, borrowed } = loaderData.overview
	const empty =
		incoming.length +
			outgoing.length +
			notices.length +
			lent.length +
			borrowed.length ===
		0
	return (
		<main className="container mb-24 flex max-w-4xl flex-col gap-8">
			<div className="flex flex-col gap-1">
				<h1 className="text-h2">Borrowing</h1>
				<p className="text-muted-foreground max-w-prose">
					Cards you borrow from collections shared with you, and cards others
					borrow from yours. Borrow from a deck’s “Fill from collection” menu.
				</p>
			</div>

			{empty ? (
				<div className="bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
					<h2 className="font-semibold">Nothing borrowed or lent</h2>
					<p className="text-muted-foreground max-w-prose text-sm">
						When someone shares their collection with you, a deck can fill from
						it: they get a request to approve. Collections shared with you are
						listed under{' '}
						<Link to="/collection/shared" className="underline">
							Shared with me
						</Link>
						.
					</p>
				</div>
			) : null}

			{incoming.length ? (
				<Section title="Requests to you">
					{incoming.map((request) => (
						<IncomingRequest key={request.id} request={request} />
					))}
				</Section>
			) : null}

			{notices.length ? (
				<Section title="Waiting for your answer">
					{notices.map((notice) => (
						<Notice key={notice.noticeId} notice={notice} />
					))}
				</Section>
			) : null}

			{outgoing.length ? (
				<Section title="Your requests">
					{outgoing.map((request) => {
						const lender = displayName(request.lender)
						return (
							<Card
								key={request.id}
								heading={`Waiting for ${lender} to approve ${cards(request.copies)}`}
								detail={`Asked ${formatDate(request.createdAt)}`}
								actions={
									<BorrowingActionButton
										fields={{ intent: 'cancel', requestId: request.id }}
										confirmLabel="Withdraw?"
										accessibleName={`Withdraw your request to ${lender}`}
									>
										Withdraw
									</BorrowingActionButton>
								}
							>
								<DeckCardList rows={request.cards} />
							</Card>
						)
					})}
				</Section>
			) : null}

			{lent.length ? (
				<Section title="Lent out">
					{lent.map((group) => {
						const borrower = displayName(group.borrower)
						return (
							<Card
								key={group.borrower.id}
								heading={`${cards(group.copies)} lent to ${borrower}`}
							>
								<ul className="flex flex-col divide-y text-sm">
									{group.cards.map((card) => (
										<li
											key={card.cardId}
											className="flex items-center justify-between gap-3 py-1.5"
										>
											<span className="tabular-nums">
												{card.quantity}× {card.title}
											</span>
											<BorrowingActionButton
												fields={{
													intent: 'revoke',
													cardId: card.cardId,
													borrowerId: group.borrower.id,
												}}
												confirmLabel="Take back?"
												accessibleName={`Take back ${card.title} from ${borrower}`}
											>
												Take back
											</BorrowingActionButton>
										</li>
									))}
								</ul>
							</Card>
						)
					})}
				</Section>
			) : null}

			{borrowed.length ? (
				<Section title="Borrowed">
					{borrowed.map((group) => (
						<Card
							key={group.lender.id}
							heading={`${cards(group.copies)} lent to you by ${displayName(group.lender)}`}
						>
							<DeckCardList rows={group.cards} />
						</Card>
					))}
				</Section>
			) : null}
		</main>
	)
}

function Section({
	title,
	children,
}: {
	title: string
	children: React.ReactNode
}) {
	return (
		<section aria-label={title} className="flex flex-col gap-3">
			<h2 className="text-h5">{title}</h2>
			<ul className="flex flex-col gap-3">{children}</ul>
		</section>
	)
}

function Card({
	heading,
	detail,
	actions,
	children,
}: {
	heading: string
	detail?: string
	actions?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<li className="flex flex-col gap-3 rounded-lg border p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<UserIcon className="bg-muted size-10 shrink-0" />
					<div className="flex min-w-0 flex-col">
						<span className="font-semibold">{heading}</span>
						{detail ? (
							<span className="text-muted-foreground text-sm">{detail}</span>
						) : null}
					</div>
				</div>
				{actions ? <div className="flex gap-2">{actions}</div> : null}
			</div>
			{children}
		</li>
	)
}

type DeckCardRow = BorrowingOverview['borrowed'][number]['cards'][number]

/** The cards in each of the borrower's own decks, the decks linked. */
function DeckCardList({ rows }: { rows: DeckCardRow[] }) {
	const decks = new Map<string, { name: string; rows: DeckCardRow[] }>()
	for (const row of rows) {
		const deck = decks.get(row.deckId)
		if (deck) deck.rows.push(row)
		else decks.set(row.deckId, { name: row.deckName, rows: [row] })
	}
	return (
		<div className="flex flex-col gap-3">
			{[...decks.entries()]
				.sort(([, a], [, b]) => a.name.localeCompare(b.name))
				.map(([deckId, deck]) => (
					<section key={deckId} aria-label={deck.name} className="text-sm">
						<h3 className="text-muted-foreground mb-1 text-xs font-semibold">
							In{' '}
							<Link to={`/decks/${deckId}`} className="underline">
								{deck.name}
							</Link>
						</h3>
						<ul className="grid gap-x-6 gap-y-1 tabular-nums sm:grid-cols-2">
							{deck.rows.map((row) => (
								<li key={row.cardId}>
									{row.quantity}× {row.title}
								</li>
							))}
						</ul>
					</section>
				))}
		</div>
	)
}

function IncomingRequest({
	request,
}: {
	request: BorrowingOverview['incoming'][number]
}) {
	const borrower = displayName(request.borrower)
	return (
		<Card
			heading={`${borrower} would like to borrow ${cards(request.copies)}`}
			detail={
				formatDate(request.updatedAt) === formatDate(request.createdAt)
					? `Asked ${formatDate(request.createdAt)}`
					: `Asked ${formatDate(request.createdAt)}, added to ${formatDate(request.updatedAt)}`
			}
			actions={
				<>
					<BorrowingActionButton
						fields={{ intent: 'reject', requestId: request.id }}
						confirmLabel="Reject?"
						accessibleName={`Reject ${borrower}’s request`}
					>
						Reject
					</BorrowingActionButton>
					<BorrowingActionButton
						fields={{ intent: 'approve', requestId: request.id }}
						variant="default"
						accessibleName={`Approve ${borrower}’s request`}
					>
						Approve
					</BorrowingActionButton>
				</>
			}
		>
			<ul className="grid gap-x-6 gap-y-1 text-sm tabular-nums sm:grid-cols-2">
				{request.cards.map((card) => (
					<li key={card.cardId}>
						{card.quantity}× {card.title}
					</li>
				))}
			</ul>
		</Card>
	)
}

function Notice({ notice }: { notice: BorrowingOverview['notices'][number] }) {
	const lender = displayName(notice.lender)
	const what =
		notice.status === 'rejected'
			? `${lender} didn’t lend you ${cards(notice.copies)}`
			: `${lender} took back ${cards(notice.copies)}`
	return (
		<Card
			heading={what}
			detail={
				notice.canAskAgain
					? 'They stay in your decks, marked, until you accept or ask again.'
					: `${lender} no longer shares their collection with you.`
			}
			actions={
				<>
					<BorrowingActionButton
						fields={{
							intent: 'answer-notice',
							noticeId: notice.noticeId,
							answer: 'accept',
						}}
					>
						Accept
					</BorrowingActionButton>
					{notice.canAskAgain ? (
						<BorrowingActionButton
							fields={{
								intent: 'answer-notice',
								noticeId: notice.noticeId,
								answer: 'ask-again',
							}}
						>
							Ask again
						</BorrowingActionButton>
					) : null}
				</>
			}
		>
			<DeckCardList rows={notice.cards} />
		</Card>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
