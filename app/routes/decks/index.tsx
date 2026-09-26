import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { AlertTriangle, Plus, SearchMd } from '@untitledui/icons'
import { Link } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	DeckSummaryCard,
	PrivateBadge,
} from '#app/components/deck-summary-card.tsx'
import { buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { type DeckSummary, listDecks } from '#app/utils/deck.server.ts'
import { pageTitle } from '#app/utils/misc.tsx'
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
				<div className="flex flex-wrap gap-2">
					<Link
						to="/decklists"
						prefetch="intent"
						className={buttonVariants({ variant: 'outline' })}
					>
						<Icon icon={SearchMd}>Find decklists</Icon>
					</Link>
					<Link to="/decks/new" className={buttonVariants()}>
						<Icon icon={Plus}>New deck</Icon>
					</Link>
				</div>
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
	return (
		<DeckSummaryCard deck={deck}>
			{deck.isPublic ? null : <PrivateBadge />}
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
					{deck.copiesFromCollection === 1 ? 'card' : 'cards'} from collection
				</span>
			) : null}
		</DeckSummaryCard>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
