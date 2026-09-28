import { Bell01 } from '@untitledui/icons'
import { Link } from 'react-router'
import { type BorrowingNotification } from '#app/utils/borrowing.ts'
import { formatDate } from '#app/utils/dates.ts'
import { cn } from '#app/utils/misc.tsx'
import { BorrowingActionButton } from './borrowing-ui.tsx'
import { buttonVariants } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from './ui/popover.tsx'

function cards(n: number) {
	return `${n} ${n === 1 ? 'card' : 'cards'}`
}

/**
 * The header's bell: borrow requests to answer and copies a lender didn't
 * lend (or took back), each answerable right here. The details are on the
 * Borrowing page.
 */
export function NotificationBell({
	notifications,
}: {
	notifications: BorrowingNotification[]
}) {
	const count = notifications.length
	return (
		<Popover>
			<PopoverTrigger
				className={cn(
					buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
					'relative size-10 rounded-full',
				)}
				aria-label={
					count
						? `Notifications: ${count} ${count === 1 ? 'needs' : 'need'} your answer`
						: 'Notifications'
				}
			>
				<Icon icon={Bell01} className="size-5" />
				{count > 0 ? (
					<span
						aria-hidden
						className="bg-destructive absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.65rem] font-bold text-white tabular-nums"
					>
						{count > 9 ? '9+' : count}
					</span>
				) : null}
			</PopoverTrigger>
			<PopoverContent className="w-[min(24rem,calc(100vw-2rem))]">
				<header className="flex items-center justify-between gap-2 border-b px-4 py-3">
					<PopoverTitle className="font-semibold">Notifications</PopoverTitle>
					<Link
						to="/borrowing"
						className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
					>
						Borrowing
					</Link>
				</header>
				{count === 0 ? (
					<p className="text-muted-foreground px-4 py-8 text-center text-sm">
						Nothing needs your answer.
					</p>
				) : (
					<ul className="divide-y">
						{notifications.map((notification) => (
							<li
								key={
									notification.kind === 'request'
										? notification.requestId
										: notification.noticeId
								}
								className="flex flex-col gap-2 px-4 py-3"
							>
								<NotificationItem notification={notification} />
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	)
}

function NotificationItem({
	notification,
}: {
	notification: BorrowingNotification
}) {
	if (notification.kind === 'request') {
		const { borrowerName, copies, requestId } = notification
		return (
			<>
				<Text
					title={`${borrowerName} would like to borrow ${cards(copies)}`}
					detail={formatDate(notification.date)}
				/>
				<div className="flex gap-2">
					<BorrowingActionButton
						fields={{ intent: 'approve', requestId }}
						variant="default"
						accessibleName={`Approve ${borrowerName}’s request`}
					>
						Approve
					</BorrowingActionButton>
					<BorrowingActionButton
						fields={{ intent: 'reject', requestId }}
						confirmLabel="Reject?"
						accessibleName={`Reject ${borrowerName}’s request`}
					>
						Reject
					</BorrowingActionButton>
					<Link
						to="/borrowing"
						className="text-muted-foreground hover:text-foreground ml-auto self-center text-xs underline underline-offset-2"
					>
						See cards
					</Link>
				</div>
			</>
		)
	}
	const { lenderName, copies, noticeId, canAskAgain, status } = notification
	return (
		<>
			<Text
				title={
					status === 'rejected'
						? `${lenderName} didn’t lend you ${cards(copies)}`
						: `${lenderName} took back ${cards(copies)}`
				}
				detail={
					canAskAgain
						? formatDate(notification.date)
						: `${lenderName} no longer shares their collection with you`
				}
			/>
			<div className="flex gap-2">
				<BorrowingActionButton
					fields={{ intent: 'answer-notice', noticeId, answer: 'accept' }}
				>
					Accept
				</BorrowingActionButton>
				{canAskAgain ? (
					<BorrowingActionButton
						fields={{ intent: 'answer-notice', noticeId, answer: 'ask-again' }}
					>
						Ask again
					</BorrowingActionButton>
				) : null}
				<Link
					to="/borrowing"
					className="text-muted-foreground hover:text-foreground ml-auto self-center text-xs underline underline-offset-2"
				>
					See cards
				</Link>
			</div>
		</>
	)
}

function Text({ title, detail }: { title: string; detail: string }) {
	return (
		<p className="flex flex-col text-sm">
			<span className="font-medium">{title}</span>
			<span className="text-muted-foreground text-xs">{detail}</span>
		</p>
	)
}
