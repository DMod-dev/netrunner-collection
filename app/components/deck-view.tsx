import { Link, useLocation } from 'react-router'
import { CopyDeckButton } from '#app/routes/resources/deck.tsx'
import { formatDate } from '#app/utils/dates.ts'
import { toNrdbText } from '#app/utils/deck-export.ts'
import { DECK_FORMAT_NAMES } from '#app/utils/deck-formats.ts'
import { evaluateDeck } from '#app/utils/deck-rules.ts'
import { type BuilderDeck } from '#app/utils/deck.server.ts'
import { DeckExportMenu } from './deck-io.tsx'
import {
	DecklistPanel,
	DeckStats,
	IdentityArt,
	ProblemList,
} from './deck-ui.tsx'
import { FactionDot } from './printing-tile.tsx'
import { buttonVariants } from './ui/button.tsx'

/** A link to a user's public decks. */
export function authorDecksPath(username: string) {
	return `/decklists?${new URLSearchParams({ author: username })}`
}

/**
 * Someone else's public deck, read only: its identity, stats and cards, to
 * export or copy into your own decks.
 */
export function DeckView({
	deck,
	signedIn,
}: {
	deck: BuilderDeck
	signedIn: boolean
}) {
	const { pathname } = useLocation()
	const evaluation = evaluateDeck({
		identity: deck.identity,
		cards: deck.cards,
		formatId: deck.formatId,
		requireLegality: deck.requireLegality,
		rules: deck.rules,
	})
	const { identity } = deck
	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-col gap-3">
				<Link
					to="/decklists"
					className="text-muted-foreground hover:text-foreground self-start text-sm"
				>
					← Decklists
				</Link>
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="text-h2 break-words">{deck.name}</h1>
						<p className="text-muted-foreground text-sm">
							by{' '}
							<Link
								to={authorDecksPath(deck.owner.username)}
								className="hover:text-foreground underline"
							>
								{deck.owner.name ?? deck.owner.username}
							</Link>{' '}
							· {DECK_FORMAT_NAMES[deck.formatId]} · updated{' '}
							{formatDate(deck.updatedAt)}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<DeckExportMenu
							deckId={deck.id}
							text={toNrdbText(deck, evaluation)}
							missing={null}
							isPublic
						/>
						{signedIn ? (
							<CopyDeckButton deckId={deck.id} />
						) : (
							<Link
								to={`/login?${new URLSearchParams({ redirectTo: pathname })}`}
								className={buttonVariants({ variant: 'outline' })}
							>
								Log in to copy
							</Link>
						)}
					</div>
				</div>
				{deck.rules?.restrictionName || deck.nrdbUrl ? (
					<p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
						{deck.rules?.restrictionName ? (
							<span>
								{DECK_FORMAT_NAMES[deck.formatId]}: {deck.rules.restrictionName}
							</span>
						) : null}
						{deck.nrdbUrl ? (
							<a
								href={deck.nrdbUrl}
								target="_blank"
								rel="noreferrer"
								className="hover:text-foreground underline"
							>
								Imported from NetrunnerDB
							</a>
						) : null}
					</p>
				) : null}
			</header>

			<div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
				<aside
					aria-label="Deck summary"
					className="flex flex-col gap-4 lg:sticky lg:top-4"
				>
					<section aria-label="Identity" className="flex items-start gap-3">
						<div className="w-20 shrink-0 lg:w-24">
							{identity ? (
								<IdentityArt identity={identity} showTitle={false} />
							) : (
								<div className="bg-muted aspect-[5/7] rounded-md" />
							)}
						</div>
						<div className="flex min-w-0 flex-col gap-1">
							<h2 className="leading-tight font-bold">
								{identity?.title ?? 'No identity'}
							</h2>
							{identity ? (
								<p className="text-muted-foreground text-xs">
									<FactionDot factionId={identity.factionId} />{' '}
									{identity.factionName} · {identity.minimumDeckSize ?? '–'}{' '}
									cards · {identity.influenceLimit ?? '∞'} influence
								</p>
							) : null}
						</div>
					</section>
					<DeckStats
						stats={evaluation.stats}
						checkFormat={deck.requireLegality}
					/>
					<ProblemList problems={evaluation.problems} />
				</aside>

				<div className="flex min-w-0 flex-col gap-6">
					<DecklistPanel
						deckId={deck.id}
						side={deck.sideId}
						entries={deck.cards}
						perCard={evaluation.perCard}
						readOnly
					/>
					{deck.notes ? (
						<section
							aria-labelledby="deck-notes"
							className="flex flex-col gap-1"
						>
							<h2 id="deck-notes" className="text-sm font-semibold">
								Notes
							</h2>
							<p className="max-w-prose text-sm whitespace-pre-wrap">
								{deck.notes}
							</p>
						</section>
					) : null}
				</div>
			</div>
		</main>
	)
}
