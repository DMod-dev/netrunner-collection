import { AlertCircle, AlertTriangle, CheckCircle } from '@untitledui/icons'
import { DeckQuantityStepper } from '#app/routes/resources/deck.tsx'
import {
	type CardLite,
	type DeckEvaluation,
	type DeckStats as DeckStatsData,
	type Problem,
} from '#app/utils/deck-rules.ts'
import { DECK_CARD_TYPES, type DeckSide } from '#app/utils/deck.ts'
import { cn } from '#app/utils/misc.tsx'
import { FactionDot, factionColor } from './printing-tile.tsx'
import { Icon } from './ui/icon.tsx'

/** A card as the builder shows it: what the rules need, plus its art. */
export type DeckCardInfo = CardLite & {
	typeName: string
	imageUrl: string | null
}

export type DecklistEntry = { card: DeckCardInfo; quantity: number }

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

/** Cards, influence, agenda points and format points, each against its limit. */
export function DeckStats({ stats }: { stats: DeckStatsData }) {
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
					bad={points > pointLimit}
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

/** The decklist grouped by type, in the order players expect for the side. */
function groupByType(entries: DecklistEntry[], side: DeckSide) {
	const order = DECK_CARD_TYPES[side]
	const groups = new Map<string, { name: string; entries: DecklistEntry[] }>()
	for (const entry of entries) {
		const { typeId, typeName } = entry.card
		const group = groups.get(typeId)
		if (group) group.entries.push(entry)
		else groups.set(typeId, { name: typeName, entries: [entry] })
	}
	const rank = (typeId: string) => {
		const i = order.indexOf(typeId)
		return i === -1 ? order.length : i
	}
	return [...groups.entries()]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([typeId, group]) => ({
			typeId,
			name: group.name,
			count: group.entries.reduce((n, e) => n + e.quantity, 0),
			entries: [...group.entries].sort((a, b) =>
				a.card.title.localeCompare(b.card.title),
			),
		}))
}

export function DecklistPanel({
	deckId,
	side,
	entries,
	perCard,
}: {
	deckId: string
	side: DeckSide
	entries: DecklistEntry[]
	perCard: DeckEvaluation['perCard']
}) {
	if (entries.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No cards yet. Add some from the card browser.
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-3">
			{groupByType(entries, side).map((group) => (
				<section key={group.typeId} aria-label={group.name}>
					<h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
						{group.name} ({group.count})
					</h3>
					<ul className="flex flex-col">
						{group.entries.map(({ card, quantity }) => {
							const info = perCard[card.id]
							const problems = info?.problems ?? []
							const worst = problems.some((p) => p.severity === 'error')
								? 'error'
								: problems.length
									? 'warning'
									: null
							return (
								<li
									key={card.id}
									data-deck-card={card.id}
									className="flex items-center gap-2 py-0.5 text-sm"
								>
									<span className="w-6 shrink-0 text-right font-bold tabular-nums">
										{quantity}×
									</span>
									<FactionDot factionId={card.factionId} />
									<span className="min-w-0 flex-1 truncate" title={card.title}>
										{card.title}
									</span>
									<InfluencePips
										influence={info?.influence ?? 0}
										factionId={card.factionId}
									/>
									{worst ? (
										<span
											title={problems.map((p) => p.message).join('\n')}
											className="flex"
										>
											<ProblemIcon severity={worst} />
											<span className="sr-only">
												{problems.map((p) => p.message).join('. ')}
											</span>
										</span>
									) : null}
									<DeckQuantityStepper
										deckId={deckId}
										cardId={card.id}
										title={card.title}
										quantity={quantity}
										deckLimit={card.deckLimit}
										size="sm"
									/>
								</li>
							)
						})}
					</ul>
				</section>
			))}
		</div>
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
