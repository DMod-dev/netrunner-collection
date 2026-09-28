import { Lock01 } from '@untitledui/icons'
import { Link } from 'react-router'
import { formatDate } from '#app/utils/dates.ts'
import { DECK_FORMAT_NAMES } from '#app/utils/deck-formats.ts'
import { type PublicDeckSummary } from '#app/utils/deck.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { FactionDot } from './printing-tile.tsx'
import { Icon } from './ui/icon.tsx'

/** What every deck list knows about a deck. */
type DeckSummaryBase = Omit<PublicDeckSummary, 'owner'>

/**
 * A deck in a list: its identity's art, name, format and size, linking to
 * it. `byline` names the owner in the decklist search; `children` are extra
 * badges.
 */
export function DeckSummaryCard({
	deck,
	byline,
	children,
}: {
	deck: DeckSummaryBase
	byline?: string
	children?: React.ReactNode
}) {
	const { identity } = deck
	return (
		<Link
			to={`/decks/${deck.id}`}
			className="bg-muted/50 hover:bg-muted focus-visible:ring-ring flex h-full gap-3 rounded-lg p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
		>
			<div className="bg-muted aspect-[5/7] w-20 shrink-0 overflow-hidden rounded-md">
				{identity?.imageUrl ? (
					<img
						src={identity.imageUrl}
						alt=""
						loading="lazy"
						width={80}
						height={112}
						className="size-full object-cover"
					/>
				) : null}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h2 className="truncate font-bold">{deck.name}</h2>
				{byline ? (
					<p className="text-muted-foreground truncate text-xs">by {byline}</p>
				) : null}
				<p className="text-muted-foreground truncate text-xs">
					{identity ? (
						<>
							<FactionDot factionId={identity.factionId} /> {identity.title}
						</>
					) : (
						'No identity'
					)}
				</p>
				<p className="text-sm tabular-nums">
					{DECK_FORMAT_NAMES[deck.formatId]} · {deck.cardCount}
					{deck.minDeckSize !== null ? ` / ${deck.minDeckSize}` : ''} cards
				</p>
				<div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
					<LegalityBadge deck={deck} />
					{children}
					<span className="text-muted-foreground ml-auto text-xs">
						{formatDate(deck.updatedAt)}
					</span>
				</div>
			</div>
		</Link>
	)
}

/** "Private", for the owner's own list. */
export function PrivateBadge() {
	return (
		<span className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
			<Icon icon={Lock01} size="xs" />
			Private
		</span>
	)
}

function LegalityBadge({ deck }: { deck: DeckSummaryBase }) {
	const { errorCount, warningCount, requireLegality } = deck
	const label = errorCount
		? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`
		: warningCount
			? `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`
			: // an unchecked format could still have banned cards
				requireLegality
				? 'Legal'
				: 'No errors'
	return (
		<span
			className={cn(
				'rounded-full px-2 py-0.5 text-xs font-semibold',
				errorCount
					? 'bg-destructive/15 text-destructive'
					: warningCount
						? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
						: 'bg-success text-success-foreground',
			)}
		>
			{label}
		</span>
	)
}
