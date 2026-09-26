import {
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	ChevronDown,
} from '@untitledui/icons'
import {
	DeckCollectionStepper,
	DeckQuantityStepper,
} from '#app/routes/resources/deck.tsx'
import {
	type Availability,
	fillStatus,
	type FillStatus,
	NO_COPIES,
	type Reservation,
} from '#app/utils/deck-fill.ts'
import {
	type CardLite,
	type DeckEvaluation,
	type DeckStats as DeckStatsData,
	type Problem,
} from '#app/utils/deck-rules.ts'
import { type DeckSide, groupByType } from '#app/utils/deck.ts'
import { cn } from '#app/utils/misc.tsx'
import { CardArtTile } from './card-art.tsx'
import { FactionDot, factionColor } from './printing-tile.tsx'
import { Icon } from './ui/icon.tsx'

/** A card as the builder shows it: what the rules need, plus its art. */
export type DeckCardInfo = CardLite & {
	typeName: string
	imageUrl: string | null
}

export type DecklistEntry = {
	card: DeckCardInfo
	quantity: number
	/** copies reserved from the collection */
	fromCollection: number
}

/** A deck's view of the collection, for its rows' badges. */
export type DeckCollection = {
	filled: boolean
	availability: Record<string, Availability>
}

/** How a row of a filled deck stands against the collection. */
export function rowFillStatus(
	collection: DeckCollection,
	cardId: string,
	quantity: number,
	fromCollection: number,
) {
	const availability = collection.availability[cardId] ?? NO_COPIES
	return {
		status: fillStatus({
			quantity,
			fromCollection,
			owned: availability.owned,
			available: availability.available,
		}),
		reservedBy: availability.reservedBy,
	}
}

const pill = 'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums'

/**
 * Why a row of a filled deck is short: copies the user doesn't own (amber),
 * copies their other decks hold (violet), and free copies that filling again
 * would take.
 */
export function FillStatusBadge({
	status,
	reservedBy,
}: {
	status: FillStatus
	reservedBy: Reservation[]
}) {
	if (status.kind === 'ok') return null
	return (
		<>
			{status.need > 0 ? (
				<span
					className={cn(
						pill,
						'bg-amber-500/15 text-amber-700 dark:text-amber-300',
					)}
					title={`You own ${status.need} too few`}
				>
					need {status.need}
				</span>
			) : null}
			{status.inUse > 0 ? (
				<span
					className={cn(
						pill,
						'max-w-full truncate bg-violet-500/15 text-violet-700 dark:text-violet-300',
					)}
					title={`In use by ${reservedBy
						.map((r) => `${r.name} (${r.quantity})`)
						.join(', ')}`}
				>
					{status.inUse} in use: {reservedBy.map((r) => r.name).join(', ')}
				</span>
			) : null}
			{status.unreserved > 0 ? (
				<span
					className={cn(pill, 'bg-muted text-muted-foreground')}
					title="Free in your collection; fill again to reserve"
				>
					{status.unreserved} not reserved
				</span>
			) : null}
		</>
	)
}

/** "2/3": copies from the collection out of the copies the deck plays. */
export function FromCollectionCount({
	fromCollection,
	quantity,
	title,
}: {
	fromCollection: number
	quantity: number
	title: string
}) {
	return (
		<span
			className={cn(
				pill,
				'shrink-0',
				fromCollection >= quantity
					? 'bg-success text-success-foreground'
					: 'bg-secondary text-secondary-foreground',
			)}
			title={`${fromCollection} of ${quantity} ${title} from your collection`}
		>
			<span className="sr-only">From collection: </span>
			{fromCollection}/{quantity}
		</span>
	)
}

/**
 * One dot per point of influence, in the card's faction color. Nothing for
 * none, so in-faction cards stay quiet.
 */
export function InfluencePips({
	influence,
	factionId,
	className,
}: {
	influence: number
	factionId: string
	className?: string
}) {
	if (influence <= 0) return null
	const label = `${influence} influence`
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className={cn('inline-flex max-w-16 flex-wrap gap-0.5', className)}
		>
			{Array.from({ length: influence }, (_, i) => (
				<span
					key={i}
					className="size-1.5 rounded-full"
					style={{ backgroundColor: factionColor(factionId) }}
				/>
			))}
		</span>
	)
}

/**
 * Cards, influence, agenda points and format points, each against its limit.
 * Going over the points limit only shows when the format is `checkFormat`ed.
 */
export function DeckStats({
	stats,
	checkFormat,
}: {
	stats: DeckStatsData
	checkFormat: boolean
}) {
	const {
		cardCount,
		minDeckSize,
		influenceSpent,
		influenceLimit,
		agendaPoints,
		agendaMin,
		agendaMax,
		points,
		pointLimit,
	} = stats
	return (
		<dl className="grid grid-cols-2 gap-2 text-sm">
			<Stat
				label="Cards"
				value={`${cardCount} / ${minDeckSize ?? '–'}`}
				bad={minDeckSize !== null && cardCount < minDeckSize}
			/>
			<Stat
				label="Influence"
				value={`${influenceSpent} / ${influenceLimit ?? '∞'}`}
				bad={influenceLimit !== null && influenceSpent > influenceLimit}
			/>
			{agendaPoints !== null && agendaMin !== null && agendaMax !== null ? (
				<Stat
					label="Agenda points"
					value={String(agendaPoints)}
					detail={`need ${agendaMin}–${agendaMax}`}
					bad={agendaPoints < agendaMin || agendaPoints > agendaMax}
				/>
			) : null}
			{points !== null && pointLimit !== null ? (
				<Stat
					label="Points"
					value={`${points} / ${pointLimit}`}
					bad={checkFormat && points > pointLimit}
				/>
			) : null}
		</dl>
	)
}

function Stat({
	label,
	value,
	detail,
	bad,
}: {
	label: string
	value: string
	detail?: string
	bad: boolean
}) {
	return (
		<div className="bg-muted/60 flex flex-col rounded-md px-3 py-2">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd
				className={cn(
					'font-bold tabular-nums',
					bad ? 'text-destructive' : 'text-foreground',
				)}
			>
				{value}
				{detail ? (
					<span className="text-muted-foreground ml-1 text-xs font-normal">
						({detail})
					</span>
				) : null}
			</dd>
		</div>
	)
}

function ProblemIcon({ severity }: { severity: Problem['severity'] }) {
	return severity === 'error' ? (
		<Icon icon={AlertCircle} size="sm" className="text-destructive shrink-0" />
	) : (
		<Icon
			icon={AlertTriangle}
			size="sm"
			className="shrink-0 text-amber-600 dark:text-amber-400"
		/>
	)
}

/** Everything wrong with the deck, errors and warnings in rule order. */
export function ProblemList({ problems }: { problems: Problem[] }) {
	if (problems.length === 0) {
		return (
			<p className="text-success flex items-center gap-2 text-sm font-medium">
				<Icon icon={CheckCircle} size="sm" />
				No problems
			</p>
		)
	}
	const errors = problems.filter((p) => p.severity === 'error').length
	const warnings = problems.length - errors
	return (
		<section aria-label="Problems" className="flex flex-col gap-1.5">
			<h3 className="text-sm font-semibold">
				{[
					errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : null,
					warnings
						? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
						: null,
				]
					.filter(Boolean)
					.join(' · ')}
			</h3>
			<ul className="flex flex-col gap-1 text-sm">
				{problems.map((problem, i) => (
					<li key={i} className="flex items-start gap-2">
						<span className="sr-only">
							{problem.severity === 'error' ? 'Error:' : 'Warning:'}
						</span>
						<ProblemIcon severity={problem.severity} />
						<span>{problem.message}</span>
					</li>
				))}
			</ul>
		</section>
	)
}

/** A deck that isn't filled from anyone's collection. */
const UNFILLED: DeckCollection = { filled: false, availability: {} }

/**
 * The deck's cards as their faces, grouped by type. The corner shows the
 * copies (and, once filled, the copies from the collection); hovering or
 * tapping a card opens its steppers for both. `readOnly` (someone else's
 * deck) leaves the steppers and the collection out and uses the whole width.
 */
export function DecklistPanel({
	deckId,
	side,
	entries,
	perCard,
	collection = UNFILLED,
	readOnly = false,
}: {
	deckId: string
	side: DeckSide
	entries: DecklistEntry[]
	perCard: DeckEvaluation['perCard']
	collection?: DeckCollection
	readOnly?: boolean
}) {
	if (entries.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				{readOnly
					? 'This deck has no cards yet.'
					: 'No cards yet. Add some from the card browser.'}
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-3">
			{groupByType(entries, side).map((group) => (
				<section key={group.typeId} aria-label={group.name}>
					{/* open to start with; collapsing one stays collapsed while
					    the deck changes */}
					<details open className="group/type">
						<summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mb-1 flex cursor-pointer list-none items-center gap-1 rounded-sm select-none focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
							<Icon
								icon={ChevronDown}
								size="sm"
								className="-rotate-90 transition-transform group-open/type:rotate-0"
							/>
							<h3 className="text-xs font-semibold tracking-wide uppercase">
								{group.name} ({group.count})
							</h3>
						</summary>
						<ul
							className={cn(
								'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2',
								// the panel's column: as many as keep the steppers whole
								!readOnly &&
									'lg:grid-cols-2 xl:grid-cols-3 pointer-coarse:xl:grid-cols-2',
							)}
						>
							{group.entries.map((entry) => (
								<li
									key={entry.card.id}
									data-deck-card={entry.card.id}
									className="flex min-w-0 flex-col gap-1"
								>
									<DeckCardTile
										deckId={deckId}
										entry={entry}
										info={perCard[entry.card.id]}
										collection={collection}
										readOnly={readOnly}
									/>
								</li>
							))}
						</ul>
					</details>
				</section>
			))}
		</div>
	)
}

function DeckCardTile({
	deckId,
	entry: { card, quantity, fromCollection },
	info,
	collection,
	readOnly,
}: {
	deckId: string
	entry: DecklistEntry
	info: DeckEvaluation['perCard'][string] | undefined
	collection: DeckCollection
	readOnly: boolean
}) {
	const availability = collection.availability[card.id] ?? NO_COPIES
	const fill = collection.filled
		? rowFillStatus(collection, card.id, quantity, fromCollection)
		: null
	const problems = info?.problems ?? []
	const worst = problems.some((p) => p.severity === 'error')
		? 'error'
		: problems.length
			? 'warning'
			: null
	return (
		<>
			<CardArtTile
				imageUrl={card.imageUrl}
				alt={card.title}
				compact
				badge={
					<span className="flex items-center gap-1">
						{worst ? (
							<span className="bg-background/90 flex rounded-full p-0.5">
								<ProblemIcon severity={worst} />
							</span>
						) : null}
						{fill ? (
							<FromCollectionCount
								fromCollection={fromCollection}
								quantity={quantity}
								title={card.title}
							/>
						) : null}
						<span className="bg-selected text-selected-foreground rounded-full px-2 py-0.5 text-xs font-bold tabular-nums">
							{quantity}×
						</span>
					</span>
				}
				overlay={
					<>
						<header className="flex flex-col gap-1">
							<h4 className="text-xs leading-tight font-bold">
								<FactionDot factionId={card.factionId} /> {card.title}
							</h4>
							<InfluencePips
								influence={info?.influence ?? 0}
								factionId={card.factionId}
							/>
							{problems.map((problem, i) => (
								<p
									key={i}
									className={cn(
										'text-xs font-semibold',
										problem.severity === 'error'
											? 'text-destructive'
											: 'text-amber-700 dark:text-amber-300',
									)}
								>
									{problem.message}
								</p>
							))}
						</header>
						{readOnly ? (
							<p className="mt-auto text-xs font-medium tabular-nums">
								{quantity} {quantity === 1 ? 'copy' : 'copies'}
							</p>
						) : (
							<div className="mt-auto flex flex-col gap-1">
								{/* the tile's keyboard shortcuts step this one */}
								<div data-primary className="flex flex-col gap-0.5">
									<span className="text-xs font-medium">In deck</span>
									<DeckQuantityStepper
										deckId={deckId}
										cardId={card.id}
										title={card.title}
										quantity={quantity}
										deckLimit={card.deckLimit}
										size="sm"
									/>
								</div>
								<div className="flex flex-col gap-0.5">
									<span className="text-xs font-medium">From collection</span>
									<DeckCollectionStepper
										deckId={deckId}
										cardId={card.id}
										title={card.title}
										fromCollection={fromCollection}
										max={Math.min(quantity, availability.available)}
										size="sm"
									/>
								</div>
							</div>
						)}
					</>
				}
			/>
			{fill && fill.status.kind !== 'ok' ? (
				<span className="flex min-w-0 flex-wrap gap-1">
					<FillStatusBadge {...fill} />
				</span>
			) : null}
		</>
	)
}

/** An identity's art and name, for the identity pickers. */
export function IdentityArt({
	identity,
	showTitle = true,
	className,
}: {
	identity: { title: string; factionId: string; imageUrl: string | null }
	/** Off where the title is already shown next to the art. */
	showTitle?: boolean
	className?: string
}) {
	return (
		<span
			className={cn(
				'bg-muted relative flex aspect-[5/7] w-full items-end overflow-hidden rounded-md',
				className,
			)}
		>
			{identity.imageUrl ? (
				<img
					src={identity.imageUrl}
					alt=""
					loading="lazy"
					width={150}
					height={210}
					className="absolute inset-0 size-full object-cover"
				/>
			) : null}
			{showTitle ? (
				<span className="bg-background/85 relative w-full p-1.5 text-left text-xs leading-tight font-medium backdrop-blur-sm">
					<FactionDot factionId={identity.factionId} /> {identity.title}
				</span>
			) : null}
		</span>
	)
}
