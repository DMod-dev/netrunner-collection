import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { AlertTriangle, Plus } from '@untitledui/icons'
import { Link } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot } from '#app/components/printing-tile.tsx'
import { buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { formatDate } from '#app/utils/dates.ts'
import { DECK_FORMAT_NAMES } from '#app/utils/deck-formats.ts'
import { type DeckSummary, listDecks } from '#app/utils/deck.server.ts'
import { cn, pageTitle } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	return { decks: await listDecks(userId) }
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Decks') }]

export default function DecksRoute({ loaderData }: Route.ComponentProps) {
	const { decks } = loaderData
	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-wrap items-end justify-between gap-2">
				<h1 className="text-h2">Decks</h1>
				<Link to="/decks/new" className={buttonVariants()}>
					<Icon icon={Plus}>New deck</Icon>
				</Link>
			</header>
			{decks.length === 0 ? (
				<div className="bg-muted/50 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
					<h2 className="font-semibold">No decks yet</h2>
					<p className="text-muted-foreground max-w-prose text-sm">
						Pick an identity and a format, then add cards from the whole card
						pool or just the ones you own.
					</p>
					<Link to="/decks/new" className={buttonVariants()}>
						<Icon icon={Plus}>New deck</Icon>
					</Link>
				</div>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{decks.map((deck) => (
						<li key={deck.id}>
							<DeckCard deck={deck} />
						</li>
					))}
				</ul>
			)}
		</main>
	)
}

function DeckCard({ deck }: { deck: DeckSummary }) {
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
					{deck.filledFromCollection ? (
						<span
							className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
							title={
								deck.shortFromCollection
									? 'Some cards aren’t from your collection'
									: undefined
							}
						>
							{deck.shortFromCollection ? (
								<Icon
									icon={AlertTriangle}
									size="xs"
									className="text-amber-600 dark:text-amber-400"
									title="Some cards aren’t from your collection"
								/>
							) : null}
							{deck.copiesFromCollection}{' '}
							{deck.copiesFromCollection === 1 ? 'card' : 'cards'} from
							collection
						</span>
					) : null}
					<span className="text-muted-foreground ml-auto text-xs">
						{formatDate(deck.updatedAt)}
					</span>
				</div>
			</div>
		</Link>
	)
}

function LegalityBadge({ deck }: { deck: DeckSummary }) {
	const { errorCount, warningCount } = deck
	const label = errorCount
		? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`
		: warningCount
			? `Legal · ${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`
			: 'Legal'
	return (
		<span
			className={cn(
				'rounded-full px-2 py-0.5 text-xs font-semibold',
				errorCount
					? 'bg-destructive/15 text-destructive'
					: 'bg-success text-success-foreground',
			)}
		>
			{label}
		</span>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
