import { useFetcher } from 'react-router'
import {
	BORROWING_ACTION_PATH,
	type clientAction,
} from '#app/routes/resources/borrowing.tsx'
import { useErrorToast } from '#app/routes/resources/deck.tsx'
import { type CardLoan } from '#app/utils/borrowing.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { type ButtonVariant } from './ui/button.tsx'
import { StatusButton } from './ui/status-button.tsx'

/**
 * A button posting one borrowing intent (`/resources/borrowing`). With
 * `confirm`, it takes a second click, for changes the other user notices.
 */
export function BorrowingActionButton({
	fields,
	children,
	confirmLabel,
	accessibleName,
	variant = 'outline',
	size = 'sm',
}: {
	fields: Record<string, string>
	children: React.ReactNode
	/** ask for a second click, showing this */
	confirmLabel?: string
	/** names what it acts on, when every row has the same button */
	accessibleName?: string
	variant?: ButtonVariant['variant']
	size?: ButtonVariant['size']
}) {
	const fetcher = useFetcher<typeof clientAction>()
	useErrorToast(
		fetcher,
		accessibleName ?? 'Borrowing',
		`borrowing-${Object.values(fields).join('-')}`,
	)
	const dc = useDoubleCheck()
	const busy = fetcher.state !== 'idle'
	const confirming = confirmLabel !== undefined && dc.doubleCheck
	const buttonProps = confirmLabel
		? dc.getButtonProps({ type: 'submit' })
		: { type: 'submit' as const }
	return (
		<fetcher.Form method="POST" action={BORROWING_ACTION_PATH}>
			{Object.entries(fields).map(([name, value]) => (
				<input key={name} type="hidden" name={name} value={value} />
			))}
			<StatusButton
				{...buttonProps}
				size={size}
				variant={confirming ? 'destructive' : variant}
				status={busy ? 'pending' : 'idle'}
				disabled={busy}
				aria-label={confirming ? undefined : accessibleName}
			>
				{confirming ? confirmLabel : children}
			</StatusButton>
		</fetcher.Form>
	)
}

/** The four words a card's borrowing state comes down to. */
export type BorrowBadgeStatus = 'borrowed' | 'lent' | 'pending' | 'rejected'

const BADGE: Record<BorrowBadgeStatus, { label: string; className: string }> = {
	borrowed: { label: 'Borrowed', className: 'bg-sky-600 text-white' },
	lent: { label: 'Lent', className: 'bg-indigo-600 text-white' },
	pending: {
		label: 'Pending',
		className:
			'bg-background/90 border border-dashed border-sky-600 text-sky-700 dark:text-sky-300',
	},
	rejected: { label: 'Rejected', className: 'bg-rose-600 text-white' },
}

/** "Borrowed", "Lent", "Pending" or "Rejected", as a small pill. */
export function BorrowStatusBadge({
	status,
	title,
	className,
}: {
	status: BorrowBadgeStatus
	/** who and how many, on hover where there's no overlay to say it */
	title?: string
	className?: string
}) {
	const badge = BADGE[status]
	return (
		<span
			title={title}
			className={cn(
				'rounded-full px-2 py-0.5 text-xs font-semibold shadow-sm',
				badge.className,
				className,
			)}
		>
			{badge.label}
		</span>
	)
}

/**
 * A deck card's borrowing states, most pressing first. Copies taken back
 * count as rejected: either way they aren't lent any more.
 */
export function loanBadgeStatuses(loans: CardLoan[]): BorrowBadgeStatus[] {
	const has = (...statuses: CardLoan['status'][]) =>
		loans.some((loan) => statuses.includes(loan.status))
	return [
		...(has('rejected', 'revoked') ? (['rejected'] as const) : []),
		...(has('pending') ? (['pending'] as const) : []),
		...(has('approved') ? (['borrowed'] as const) : []),
	]
}

const DETAIL: Record<
	CardLoan['status'],
	(n: number, lender: string) => string
> = {
	approved: (n, lender) => `${n} borrowed from ${lender}`,
	pending: (n, lender) => `${n} pending with ${lender}`,
	rejected: (n, lender) => `${n} rejected by ${lender}`,
	revoked: (n, lender) => `${n} taken back by ${lender}`,
}

/** "2 borrowed from Leland", one line per lender and state. */
export function loanDetails(loans: CardLoan[]) {
	return loans.map((loan) =>
		DETAIL[loan.status](loan.quantity, loan.lenderName),
	)
}

/** The card's borrowing states, for the corner of its art. */
export function LoanStatusBadges({
	loans,
	withTitles = false,
}: {
	loans: CardLoan[]
	/** say who on hover, where there's no overlay to */
	withTitles?: boolean
}) {
	const details = loanDetails(loans).join('; ')
	return (
		<>
			{loanBadgeStatuses(loans).map((status) => (
				<BorrowStatusBadge
					key={status}
					status={status}
					title={withTitles ? details : undefined}
				/>
			))}
		</>
	)
}

/** Who each state is with, for a card's hover overlay. */
export function LoanDetails({ loans }: { loans: CardLoan[] }) {
	if (loans.length === 0) return null
	return (
		<ul className="flex flex-col text-xs">
			{loans.map((loan, i) => (
				<li
					key={`${loan.lenderId}-${loan.status}-${loan.noticeId ?? i}`}
					className={cn(
						'font-semibold',
						loan.status === 'approved' || loan.status === 'pending'
							? 'text-sky-700 dark:text-sky-300'
							: 'text-rose-700 dark:text-rose-300',
					)}
				>
					{DETAIL[loan.status](loan.quantity, loan.lenderName)}
				</li>
			))}
		</ul>
	)
}
