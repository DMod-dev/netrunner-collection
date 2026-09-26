import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	AlertTriangle,
	ChevronDown,
	ChevronUp,
	Loading02,
	SearchMd,
	XClose,
} from '@untitledui/icons'
import { useId, useRef, useState } from 'react'
import {
	Form,
	Link,
	type Location,
	useFetcher,
	useFetchers,
	useLocation,
	useNavigation,
	useNavigationType,
	useSearchParams,
	useSubmit,
} from 'react-router'
import { useSpinDelay } from 'spin-delay'
import { CardArtTile, CountBadge } from '#app/components/card-art.tsx'
import {
	FilterSelect,
	Pagination,
} from '#app/components/collection-pages/cards.tsx'
import {
	type DeckCardInfo,
	type DecklistEntry,
	DecklistPanel,
	DeckStats,
	FillStatusBadge,
	IdentityArt,
	InfluencePips,
	ProblemList,
	rowFillStatus,
} from '#app/components/deck-ui.tsx'
import { DeckExportMenu, ImportDeckDialog } from '#app/components/deck-io.tsx'
import { DeckView } from '#app/components/deck-view.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot } from '#app/components/printing-tile.tsx'
import { Button, buttonVariants } from '#app/components/ui/button.tsx'
import { Checkbox } from '#app/components/ui/checkbox.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import {
	type clientAction as deckClientAction,
	DECK_ACTION_PATH,
	DeckCollectionStepper,
	DeckQuantityStepper,
	DeleteDeckButton,
	FillControls,
	pendingFromCollection,
	pendingLegality,
	pendingPublic,
	pendingQuantity,
	PublicDeckSwitch,
	RefillButton,
	RemoveIllegalCardsButton,
	RequireLegalitySwitch,
	useErrorToast,
} from '#app/routes/resources/deck.tsx'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { getFilterOptions, searchCards } from '#app/utils/collection.server.ts'
import { pickArtPrinting } from '#app/utils/collection.ts'
import { getDeckCollection } from '#app/utils/deck-fill.server.ts'
import { toNrdbText } from '#app/utils/deck-export.ts'
import { NO_COPIES } from '#app/utils/deck-fill.ts'
import {
	DECK_FORMAT_NAMES,
	DECK_FORMATS,
	type DeckFormat,
} from '#app/utils/deck-formats.ts'
import { toCardLite } from '#app/utils/deck-rules.server.ts'
import {
	type CardLite,
	type BanList,
	evaluateDeck,
	formatIssue,
	toBanList,
} from '#app/utils/deck-rules.ts'
import { getDeckForBuilder } from '#app/utils/deck.server.ts'
import {
	DECK_CARD_TYPES,
	deckCardFetcherPrefix,
	deckSettingsFetcherKey,
	MAX_DECK_NAME_LENGTH,
	MAX_DECK_NOTES_LENGTH,
	parseDeckFormat,
} from '#app/utils/deck.ts'
import { cn, pageTitle, useDebounce } from '#app/utils/misc.tsx'
import { type Route } from './+types/$deckId.ts'
import { type loader as identitiesLoader } from './new.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	const deck = await getDeckForBuilder(userId, params.deckId).catch(
		async (error: unknown) => {
			// signed out, a private deck might be theirs: sign in first
			if (!userId && error instanceof Response && error.status === 404) {
				await requireUserId(request)
			}
			throw error
		},
	)
	// someone else's public deck: read only
	if (!userId || !deck.isOwner) {
		return { mode: 'view' as const, deck, signedIn: userId !== null }
	}

	// the card browser: the collection's search, locked to the deck's side
	// and the types a deck can hold
	const url = new URL(request.url)
	const get = (key: string) => url.searchParams.get(key) || undefined
	const sideTypes = DECK_CARD_TYPES[deck.sideId]
	const type = get('type')
	const owned = get('owned')
	const [results, filterOptions] = await Promise.all([
		searchCards(userId, {
			q: get('q'),
			sides: [deck.sideId],
			factions: url.searchParams.getAll('faction').filter(Boolean),
			types: sideTypes,
			type: type && sideTypes.includes(type) ? type : undefined,
			set: get('set'),
			owned: owned === 'owned' || owned === 'missing' ? owned : undefined,
			legal:
				get('legal') === '1'
					? {
							formatId: deck.formatId,
							banned: deck.rules?.banned ?? [],
							bannedSubtypes: deck.rules?.bannedSubtypes ?? [],
						}
					: undefined,
			page: Number(get('page')) || 1,
		}),
		getFilterOptions(),
	])
	// what the collection has for the deck, and for the browser's page
	const collection = await getDeckCollection(
		userId,
		deck,
		results.cards.map((c) => c.id),
	)

	return {
		mode: 'build' as const,
		deck,
		collection,
		browser: {
			total: results.total,
			page: results.page,
			pageCount: results.pageCount,
			cards: results.cards.map((card) => {
				const art = pickArtPrinting(
					card.printings,
					card.preferredArt[0]?.printingId,
				)
				return {
					...toCardLite(card),
					typeName: card.type.name,
					factionName: card.faction.name,
					displaySubtypes: card.displaySubtypes,
					imageUrl: art?.imageLarge ?? art?.imageSmall ?? null,
					nrdbPrintingId: card.printings[0]?.id ?? null,
					owned: card.printings.reduce(
						(sum, p) =>
							sum +
							(p.collectionEntries[0]?.quantity ?? 0) +
							p.variants.reduce((vSum, v) => vSum + v.quantity, 0),
						0,
					),
				}
			}),
		},
		filters: {
			factions: filterOptions.factionToggles
				.filter((t) => t.factions.some((f) => f.sideId === deck.sideId))
				.map(({ value, name }) => ({ value, name })),
			types: filterOptions.types.filter((t) => sideTypes.includes(t.id)),
			cycles: filterOptions.cycles,
		},
	}
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
	if (!loaderData) return [{ title: pageTitle('Deck') }]
	const { deck } = loaderData
	const description = `${deck.identity?.title ?? 'A'} deck by ${deck.owner.name ?? deck.owner.username}`
	return [
		{ title: pageTitle(deck.name) },
		{ name: 'description', content: description },
		{ property: 'og:title', content: deck.name },
		{ property: 'og:description', content: description },
	]
}

type LoaderData = Extract<Route.ComponentProps['loaderData'], { mode: 'build' }>
type BrowserCard = LoaderData['browser']['cards'][number]
type Deck = LoaderData['deck']
type Collection = LoaderData['collection']

/**
 * The deck as the user has asked for it to be: the saved cards with every
 * in-flight change applied. The stats and problems follow it, so they update
 * the moment a count changes rather than after the server answers.
 */
function useOptimisticDeck(deck: Deck, browserCards: BrowserCard[]) {
	const fetchers = useFetchers()
	const legalityFetcher = useFetcher({
		key: deckSettingsFetcherKey(deck.id, 'legality'),
	})
	const prefix = deckCardFetcherPrefix(deck.id)
	const pending = new Map<string, number>()
	const pendingFrom = new Map<string, number>()
	for (const fetcher of fetchers) {
		if (!fetcher.key.startsWith(prefix)) continue
		const cardId = fetcher.formData?.get('cardId')
		if (typeof cardId !== 'string') continue
		const quantity = pendingQuantity(fetcher.formData)
		if (quantity !== null) pending.set(cardId, quantity)
		const from = pendingFromCollection(fetcher.formData)
		if (from !== null) pendingFrom.set(cardId, from)
	}

	const entries: DecklistEntry[] = []
	for (const { card, quantity, fromCollection } of deck.cards) {
		const next = pending.get(card.id) ?? quantity
		pending.delete(card.id)
		// fewer copies give reserved ones back, as the server will
		if (next > 0) {
			entries.push({
				card,
				quantity: next,
				fromCollection: Math.min(
					pendingFrom.get(card.id) ?? fromCollection,
					next,
				),
			})
		}
	}
	// cards being added: the browser has what the rules need
	for (const [cardId, quantity] of pending) {
		const card = browserCards.find((c) => c.id === cardId)
		if (card && quantity > 0)
			entries.push({ card, quantity, fromCollection: 0 })
	}
	return {
		entries,
		identityFromCollection: deck.identity
			? Math.min(
					pendingFrom.get(deck.identity.id) ?? deck.identityFromCollection,
					1,
				)
			: 0,
		requireLegality:
			pendingLegality(legalityFetcher.formData) ?? deck.requireLegality,
	}
}

export default function DeckRoute({ loaderData }: Route.ComponentProps) {
	return loaderData.mode === 'view' ? (
		<DeckView deck={loaderData.deck} signedIn={loaderData.signedIn} />
	) : (
		<DeckBuilder loaderData={loaderData} />
	)
}

function DeckBuilder({ loaderData }: { loaderData: LoaderData }) {
	const { deck, collection, browser, filters } = loaderData
	const [sheetOpen, setSheetOpen] = useState(false)
	const { entries, identityFromCollection, requireLegality } =
		useOptimisticDeck(deck, browser.cards)
	// cheap (a deck is a few dozen rows), so it just runs every render
	const evaluation = evaluateDeck({
		identity: deck.identity,
		cards: entries,
		formatId: deck.formatId,
		requireLegality,
		rules: deck.rules,
	})
	const inDeck = new Map(entries.map((e) => [e.card.id, e.quantity]))
	const saved = new Map(deck.cards.map((e) => [e.card.id, e.quantity]))
	const { stats, problems } = evaluation
	const errors = problems.filter((p) => p.severity === 'error').length
	const text = toNrdbText({ ...deck, cards: entries }, evaluation)
	const banList = toBanList(deck.rules)
	// copies "Remove cards not legal" would take out; only offered while the
	// format is checked
	const illegalCopies = requireLegality
		? entries.reduce(
				(n, e) =>
					formatIssue(e.card, deck.formatId, banList) ? n + e.quantity : n,
				0,
			)
		: 0

	return (
		<main className="container mb-24 flex flex-col gap-4 lg:mb-8">
			<DeckToolbar
				deck={deck}
				requireLegality={requireLegality}
				filled={collection.filled}
				fromCollection={
					identityFromCollection +
					entries.reduce((sum, e) => sum + e.fromCollection, 0)
				}
				total={(deck.identity ? 1 : 0) + stats.cardCount}
				text={text}
				missing={missingList(deck, identityFromCollection, entries, collection)}
			/>
			{collection.stale ? (
				<div
					role="status"
					className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
				>
					<Icon
						icon={AlertTriangle}
						size="sm"
						className="text-amber-600 dark:text-amber-400"
					>
						Your collection changed since this deck was filled.
					</Icon>
					<RefillButton deckId={deck.id} />
				</div>
			) : null}

			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
				<CardBrowser
					deck={deck}
					browser={browser}
					filters={filters}
					inDeck={inDeck}
					saved={saved}
					collection={collection}
					checkFormat={requireLegality}
				/>

				<aside
					id="deck-panel"
					aria-label="Deck"
					className={cn(
						'bg-background flex flex-col gap-4',
						// phones and tablets: a bottom sheet over the browser
						'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[85dvh] max-lg:overflow-y-auto max-lg:rounded-t-xl max-lg:border-t max-lg:p-4 max-lg:pb-20 max-lg:shadow-2xl max-lg:transition-[transform,visibility]',
						sheetOpen
							? 'max-lg:translate-y-0'
							: 'max-lg:invisible max-lg:translate-y-full',
						// desktop: a column that stays in view
						'lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:pr-1',
					)}
				>
					<IdentityHeader
						deck={deck}
						identityFromCollection={identityFromCollection}
						collection={collection}
					/>
					<DeckStats stats={stats} checkFormat={requireLegality} />
					<ProblemList problems={problems} />
					{illegalCopies > 0 ? (
						<RemoveIllegalCardsButton
							deckId={deck.id}
							count={illegalCopies}
							formatName={DECK_FORMAT_NAMES[deck.formatId]}
						/>
					) : null}
					<DecklistPanel
						deckId={deck.id}
						side={deck.sideId}
						entries={entries}
						perCard={evaluation.perCard}
						collection={collection}
					/>
					<DeckNotes deck={deck} />
				</aside>
			</div>

			{/* phones and tablets: the deck's vitals, opening the sheet */}
			<div className="bg-background/95 fixed inset-x-0 bottom-0 z-50 border-t p-2 backdrop-blur-sm lg:hidden">
				<Button
					type="button"
					variant="secondary"
					className="h-11 w-full justify-between"
					aria-expanded={sheetOpen}
					aria-controls="deck-panel"
					onClick={() => setSheetOpen((open) => !open)}
				>
					<span className="tabular-nums">
						{stats.cardCount} cards · inf {stats.influenceSpent}/
						{stats.influenceLimit ?? '∞'} ·{' '}
						<span className={cn(errors > 0 && 'text-destructive')}>
							{errors} {errors === 1 ? 'error' : 'errors'}
						</span>
					</span>
					<Icon icon={sheetOpen ? ChevronDown : ChevronUp}>
						{sheetOpen ? 'Hide deck' : 'Show deck'}
					</Icon>
				</Button>
			</div>
		</main>
	)
}

/**
 * "2x Card" for each copy a filled deck needs that the collection doesn't
 * have, identity first; null if there are none (or the deck isn't filled).
 */
function missingList(
	deck: Deck,
	identityFromCollection: number,
	entries: DecklistEntry[],
	collection: Collection,
) {
	if (!collection.filled) return null
	const rows = [
		...(deck.identity
			? [
					{
						title: deck.identity.title,
						...rowFillStatus(
							collection,
							deck.identity.id,
							1,
							identityFromCollection,
						),
					},
				]
			: []),
		...entries.map((e) => ({
			title: e.card.title,
			...rowFillStatus(collection, e.card.id, e.quantity, e.fromCollection),
		})),
	]
	const lines = rows
		.filter((row) => row.status.need > 0)
		.map((row) => `${row.status.need}x ${row.title}`)
	return lines.length ? lines.join('\n') : null
}

function DeckToolbar({
	deck,
	requireLegality,
	filled,
	fromCollection,
	total,
	text,
	missing,
}: {
	deck: Deck
	requireLegality: boolean
	filled: boolean
	fromCollection: number
	total: number
	text: string
	missing: string | null
}) {
	const id = useId()
	const nameFetcher = useFetcher<typeof deckClientAction>({
		key: deckSettingsFetcherKey(deck.id, 'name'),
	})
	const formatFetcher = useFetcher<typeof deckClientAction>({
		key: deckSettingsFetcherKey(deck.id, 'format'),
	})
	// the export menu offers the link while the deck is (going) public
	const visibilityFetcher = useFetcher({
		key: deckSettingsFetcherKey(deck.id, 'visibility'),
	})
	const isPublic = pendingPublic(visibilityFetcher.formData) ?? deck.isPublic
	useErrorToast(nameFetcher, 'Name', `name-${deck.id}`)
	useErrorToast(formatFetcher, 'Format', `format-${deck.id}`)
	const pendingFormat = formatFetcher.formData?.get('formatId')
	const format =
		typeof pendingFormat === 'string'
			? parseDeckFormat(pendingFormat)
			: deck.formatId

	return (
		<header className="flex flex-col gap-3">
			<Link
				to="/decks"
				className="text-muted-foreground hover:text-foreground self-start text-sm"
			>
				← Decks
			</Link>
			<div className="flex flex-wrap items-end gap-x-4 gap-y-3">
				<div className="flex min-w-56 flex-1 flex-col gap-1">
					<Label
						htmlFor={`${id}-name`}
						className="text-muted-foreground text-xs"
					>
						Deck name
					</Label>
					<Input
						// start over from the saved name whenever it changes
						key={deck.name}
						id={`${id}-name`}
						defaultValue={deck.name}
						maxLength={MAX_DECK_NAME_LENGTH}
						className="text-lg font-bold"
						onKeyDown={(e) => {
							if (e.key === 'Enter') e.currentTarget.blur()
							if (e.key === 'Escape') {
								e.currentTarget.value = deck.name
								e.currentTarget.blur()
							}
						}}
						onBlur={(e) => {
							const name = e.currentTarget.value.trim()
							if (!name) e.currentTarget.value = deck.name
							if (!name || name === deck.name) return
							void nameFetcher.submit(
								{ intent: 'rename', deckId: deck.id, name },
								{ method: 'POST', action: DECK_ACTION_PATH },
							)
						}}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label
						htmlFor={`${id}-format`}
						className="text-muted-foreground text-xs"
					>
						Format
					</Label>
					<NativeSelect
						id={`${id}-format`}
						value={format}
						onChange={(e) => {
							void formatFetcher.submit(
								{
									intent: 'set-format',
									deckId: deck.id,
									formatId: e.currentTarget.value,
								},
								{ method: 'POST', action: DECK_ACTION_PATH },
							)
						}}
					>
						{DECK_FORMATS.map((f) => (
							<NativeSelectOption key={f} value={f}>
								{DECK_FORMAT_NAMES[f]}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<div className="flex h-9 items-center">
					<RequireLegalitySwitch
						deckId={deck.id}
						requireLegality={requireLegality}
					/>
				</div>
				<div className="flex h-9 items-center">
					<PublicDeckSwitch deckId={deck.id} isPublic={isPublic} />
				</div>
				<FillControls
					deckId={deck.id}
					filled={filled}
					fromCollection={fromCollection}
					total={total}
				/>
				<ImportDeckDialog deckId={deck.id} />
				<DeckExportMenu
					deckId={deck.id}
					text={text}
					missing={missing}
					isPublic={isPublic}
				/>
				<DeleteDeckButton deckId={deck.id} name={deck.name} />
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
	)
}

function IdentityHeader({
	deck,
	identityFromCollection,
	collection,
}: {
	deck: Deck
	/** counting a change still being saved */
	identityFromCollection: number
	collection: Collection
}) {
	const { identity } = deck
	const fill =
		identity && collection.filled
			? rowFillStatus(collection, identity.id, 1, identityFromCollection)
			: null
	return (
		<section aria-label="Identity" className="flex items-start gap-3">
			<div className="w-16 shrink-0">
				{identity ? (
					<IdentityArt identity={identity} showTitle={false} />
				) : (
					<div className="bg-muted aspect-[5/7] rounded-md" />
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h2 className="leading-tight font-bold">
					{identity?.title ?? 'No identity'}
				</h2>
				{identity ? (
					<p className="text-muted-foreground text-xs">
						<FactionDot factionId={identity.factionId} /> {identity.factionName}{' '}
						· {identity.minimumDeckSize ?? '–'} cards ·{' '}
						{identity.influenceLimit ?? '∞'} influence
					</p>
				) : null}
				{identity ? (
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-xs font-medium">From collection</span>
						<DeckCollectionStepper
							deckId={deck.id}
							cardId={identity.id}
							title={identity.title}
							fromCollection={identityFromCollection}
							max={Math.min(
								1,
								(collection.availability[identity.id] ?? NO_COPIES).available,
							)}
							size="sm"
						/>
						{fill ? <FillStatusBadge {...fill} /> : null}
					</div>
				) : null}
				<IdentityDialog deck={deck} />
			</div>
		</section>
	)
}

/** Pick another identity of the deck's side. */
function IdentityDialog({ deck }: { deck: Deck }) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const identities = useFetcher<typeof identitiesLoader>()
	const setIdentity = useFetcher<typeof deckClientAction>({
		key: deckSettingsFetcherKey(deck.id, 'identity'),
	})
	useErrorToast(setIdentity, 'Identity', `identity-${deck.id}`)
	const [query, setQuery] = useState('')
	const [legalOnly, setLegalOnly] = useState(true)
	const id = useId()

	function open() {
		dialogRef.current?.showModal()
		if (identities.state === 'idle' && !identities.data) {
			void identities.load(`/decks/new?side=${deck.sideId}`)
		}
	}

	const q = query.trim().toLowerCase()
	const shown = (identities.data?.identities ?? []).filter(
		(identity) =>
			(!legalOnly || identity.legalFormats.includes(deck.formatId)) &&
			(!q ||
				identity.title.toLowerCase().includes(q) ||
				identity.factionName.toLowerCase().includes(q)),
	)

	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="self-start"
				disabled={setIdentity.state !== 'idle'}
				onClick={open}
			>
				{setIdentity.state !== 'idle' ? 'Changing…' : 'Change identity'}
			</Button>
			<dialog
				ref={dialogRef}
				aria-label="Change identity"
				className="bg-background text-foreground m-auto w-[min(56rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-black/50"
				onClick={(e) => {
					// clicking the backdrop closes the dialog
					if (e.target === e.currentTarget) e.currentTarget.close()
				}}
			>
				<div className="flex flex-col gap-4 p-5">
					<header className="flex items-center justify-between gap-4">
						<h2 className="text-lg font-bold">Change identity</h2>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Close"
							onClick={() => dialogRef.current?.close()}
						>
							<Icon icon={XClose} />
						</Button>
					</header>
					<div className="flex flex-wrap items-center gap-4">
						<Input
							type="search"
							aria-label="Search identities"
							placeholder="Search by name or faction"
							value={query}
							onChange={(e) => setQuery(e.currentTarget.value)}
							className="max-w-sm"
						/>
						<div className="flex items-center gap-2">
							<Checkbox
								id={`${id}-legal`}
								checked={legalOnly}
								onCheckedChange={(checked) => setLegalOnly(checked === true)}
							/>
							<Label htmlFor={`${id}-legal`} className="text-sm font-normal">
								Only identities legal in {DECK_FORMAT_NAMES[deck.formatId]}
							</Label>
						</div>
					</div>
					{!identities.data ? (
						<p className="text-muted-foreground flex items-center gap-2 text-sm">
							<Icon icon={Loading02} className="animate-spin" />
							Loading identities…
						</p>
					) : shown.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No identities match.
						</p>
					) : (
						<ul className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] sm:gap-3">
							{shown.map((identity) => (
								<li key={identity.id}>
									<button
										type="button"
										aria-current={
											identity.id === deck.identity?.id ? 'true' : undefined
										}
										className="aria-current:ring-selected focus-visible:ring-ring block w-full rounded-md ring-offset-2 focus-visible:ring-2 focus-visible:outline-none aria-current:ring-3"
										onClick={() => {
											dialogRef.current?.close()
											if (identity.id === deck.identity?.id) return
											void setIdentity.submit(
												{
													intent: 'set-identity',
													deckId: deck.id,
													identityCardId: identity.id,
												},
												{ method: 'POST', action: DECK_ACTION_PATH },
											)
										}}
									>
										<IdentityArt identity={identity} />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</dialog>
		</>
	)
}

function DeckNotes({ deck }: { deck: Deck }) {
	const fetcher = useFetcher<typeof deckClientAction>({
		key: deckSettingsFetcherKey(deck.id, 'notes'),
	})
	useErrorToast(fetcher, 'Notes', `notes-${deck.id}`)
	const id = useId()
	return (
		<details className="group" open={Boolean(deck.notes) || undefined}>
			<summary className="cursor-pointer text-sm font-semibold">Notes</summary>
			<Label htmlFor={id} className="sr-only">
				Deck notes
			</Label>
			<Textarea
				key={deck.notes ?? ''}
				id={id}
				defaultValue={deck.notes ?? ''}
				maxLength={MAX_DECK_NOTES_LENGTH}
				placeholder="Plans, tech choices, mulligan advice…"
				className="mt-2 min-h-24"
				onBlur={(e) => {
					const notes = e.currentTarget.value.trim()
					if (notes === (deck.notes ?? '')) return
					void fetcher.submit(
						{ intent: 'set-notes', deckId: deck.id, notes },
						{ method: 'POST', action: DECK_ACTION_PATH },
					)
				}}
			/>
		</details>
	)
}

// ---------------------------------------------------------------------------
// Card browser
// ---------------------------------------------------------------------------

/** The search params that filter the browser, i.e. everything but the page. */
function filtersOnly(searchParams: URLSearchParams) {
	const params = new URLSearchParams(searchParams)
	params.delete('page')
	return params.toString()
}

/** Navigations the filter form made itself carry this in `location.state`. */
const FROM_FILTERS = 'deck-browser-filters'
function isFromFilters(location: Location) {
	return (location.state as { from?: unknown } | null)?.from === FROM_FILTERS
}

function CardBrowser({
	deck,
	browser,
	filters,
	inDeck,
	saved,
	collection,
	checkFormat,
}: {
	deck: Deck
	browser: LoaderData['browser']
	filters: LoaderData['filters']
	collection: Collection
	/** "Require deck legality": mark the cards the format won't take */
	checkFormat: boolean
	/** Copies in the deck, counting changes still being saved. */
	inDeck: Map<string, number>
	/** Copies in the deck as last saved. */
	saved: Map<string, number>
}) {
	const [searchParams] = useSearchParams()
	const location = useLocation()
	const navigation = useNavigation()
	const navigationType = useNavigationType()
	const banList = toBanList(deck.rules)
	const isLoading =
		navigation.state === 'loading' &&
		navigation.location.pathname === location.pathname
	const showPending = useSpinDelay(isLoading, { delay: 300, minDuration: 300 })

	// The filter inputs are uncontrolled. When the filters change from outside
	// the form (clearing them, back/forward), remount it so the inputs match
	// the URL again. Its own searches don't, so typing is never interrupted.
	const filterSearch = filtersOnly(searchParams)
	const [filtersForm, setFiltersForm] = useState({
		search: filterSearch,
		key: 0,
	})
	if (filtersForm.search !== filterSearch) {
		setFiltersForm({
			search: filterSearch,
			key:
				navigationType !== 'POP' && isFromFilters(location)
					? filtersForm.key
					: filtersForm.key + 1,
		})
	}

	return (
		<section aria-label="Card browser" className="flex min-w-0 flex-col gap-4">
			<BrowserFilters
				key={filtersForm.key}
				filters={filters}
				format={deck.formatId}
			/>
			<p className="text-muted-foreground text-sm" aria-live="polite">
				{showPending
					? 'Searching…'
					: `${browser.total.toLocaleString()} ${browser.total === 1 ? 'card' : 'cards'}`}
			</p>
			<div className="relative">
				{browser.cards.length === 0 ? (
					<div className="bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
						<h2 className="font-semibold">No cards match these filters</h2>
						<Link
							to="."
							replace
							preventScrollReset
							className={buttonVariants({ variant: 'outline' })}
						>
							Clear filters
						</Link>
					</div>
				) : (
					<ul
						aria-busy={isLoading}
						className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
					>
						{browser.cards.map((card) => (
							<li key={card.id}>
								<BrowserCardTile
									card={card}
									deck={deck}
									inDeck={inDeck.get(card.id) ?? 0}
									saved={saved.get(card.id) ?? 0}
									collection={collection}
									checkFormat={checkFormat}
									banList={banList}
								/>
							</li>
						))}
					</ul>
				)}
				{showPending ? (
					<div className="bg-background/50 absolute inset-0 z-10 flex justify-center rounded-lg">
						<span className="bg-background text-muted-foreground sticky top-4 mt-4 flex h-8 items-center gap-2 self-start rounded-full border px-3 text-sm shadow-sm">
							<Icon icon={Loading02} className="animate-spin" />
							Searching…
						</span>
					</div>
				) : null}
			</div>
			{browser.pageCount > 1 ? (
				<Pagination page={browser.page} pageCount={browser.pageCount} />
			) : null}
		</section>
	)
}

function BrowserFilters({
	filters,
	format,
}: {
	filters: LoaderData['filters']
	format: DeckFormat
}) {
	const [searchParams] = useSearchParams()
	const location = useLocation()
	const submit = useSubmit()
	const id = useId()
	// the form remounts when the filters change from outside it, so the
	// input only needs the URL's value once
	const [initialQuery] = useState(() => searchParams.get('q') ?? '')

	// Submit only the filters that are set, so URLs stay short.
	function submitFilters(form: HTMLFormElement) {
		const params = new URLSearchParams()
		for (const [key, value] of new FormData(form)) {
			if (typeof value === 'string' && value !== '') params.append(key, value)
		}
		if (params.toString() === searchParams.toString()) return
		void submit(params, {
			method: 'GET',
			action: location.pathname,
			replace: true,
			preventScrollReset: true,
			state: { from: FROM_FILTERS },
		})
	}
	const autoSubmit = useDebounce(submitFilters, 300)
	const hasFilters = filtersOnly(searchParams) !== ''

	return (
		<Form
			method="GET"
			className="bg-muted flex flex-col gap-3 rounded-lg p-3"
			onChange={(e) => autoSubmit(e.currentTarget)}
			onSubmit={(e) => {
				e.preventDefault()
				autoSubmit.cancel()
				submitFilters(e.currentTarget)
			}}
		>
			<div className="flex gap-2">
				<Label htmlFor={`${id}-q`} className="sr-only">
					Card name
				</Label>
				<Input
					id={`${id}-q`}
					type="search"
					name="q"
					placeholder="Search cards by name"
					defaultValue={initialQuery}
					autoComplete="off"
					className="bg-background"
				/>
				<Button type="submit" size="icon" aria-label="Search">
					<Icon icon={SearchMd} size="sm" />
				</Button>
				{hasFilters ? (
					<Link
						to="."
						replace
						preventScrollReset
						aria-label="Clear filters"
						className={cn(
							buttonVariants({ variant: 'outline' }),
							'bg-background shrink-0',
						)}
					>
						<Icon icon={XClose} size="sm" />
					</Link>
				) : null}
			</div>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<FilterSelect
					name="faction"
					label="Faction"
					searchParams={searchParams}
				>
					{filters.factions.map((f) => (
						<NativeSelectOption key={f.value} value={f.value}>
							{f.name}
						</NativeSelectOption>
					))}
				</FilterSelect>
				<FilterSelect name="type" label="Type" searchParams={searchParams}>
					{filters.types.map((t) => (
						<NativeSelectOption key={t.id} value={t.id}>
							{t.name}
						</NativeSelectOption>
					))}
				</FilterSelect>
				<FilterSelect name="set" label="Set" searchParams={searchParams}>
					{filters.cycles.map((cycle) =>
						cycle.sets.length === 1 && cycle.sets[0]!.name === cycle.name ? (
							<NativeSelectOption key={cycle.id} value={cycle.sets[0]!.id}>
								{cycle.name}
							</NativeSelectOption>
						) : (
							<NativeSelectOptGroup key={cycle.id} label={cycle.name}>
								{cycle.sets.map((s) => (
									<NativeSelectOption key={s.id} value={s.id}>
										{s.name}
									</NativeSelectOption>
								))}
							</NativeSelectOptGroup>
						),
					)}
				</FilterSelect>
				<FilterSelect
					name="owned"
					label="Owned"
					allLabel="Owned or not"
					searchParams={searchParams}
				>
					<NativeSelectOption value="owned">Owned</NativeSelectOption>
					<NativeSelectOption value="missing">Not owned</NativeSelectOption>
				</FilterSelect>
			</div>
			<label className="flex items-center gap-2 text-sm">
				{/* a native checkbox, so the form submits it like the selects */}
				<input
					type="checkbox"
					name="legal"
					value="1"
					defaultChecked={searchParams.get('legal') === '1'}
					className="accent-selected size-4"
				/>
				Only cards legal in {DECK_FORMAT_NAMES[format]}
			</label>
		</Form>
	)
}

/** "Banned" or "Not in Startup" for a card the deck's format won't take. */
function formatStatus(
	card: CardLite,
	formatId: DeckFormat,
	banList: BanList | null,
) {
	const issue = formatIssue(card, formatId, banList)
	if (!issue) return null
	return issue.code === 'not_in_format'
		? `Not in ${DECK_FORMAT_NAMES[formatId]}`
		: 'Banned'
}

function BrowserCardTile({
	card,
	deck,
	inDeck,
	saved,
	collection,
	checkFormat,
	banList,
}: {
	card: BrowserCard & DeckCardInfo
	deck: Deck
	inDeck: number
	saved: number
	collection: Collection
	/** "Require deck legality": off, nothing is marked */
	checkFormat: boolean
	banList: BanList | null
}) {
	const status = checkFormat ? formatStatus(card, deck.formatId, banList) : null
	// a filled deck counts only the copies other decks don't hold
	const availability = collection.availability[card.id] ?? NO_COPIES
	const count = collection.filled ? availability.available : card.owned
	const ownedTitle = collection.filled
		? `${availability.available} free of the ${card.owned} you own` +
			(availability.reservedBy.length
				? ` (in use by ${availability.reservedBy
						.map((r) => `${r.name}: ${r.quantity}`)
						.join(', ')})`
				: '') +
			`; deck limit ${card.deckLimit}`
		: `You own ${card.owned}; deck limit ${card.deckLimit}`
	return (
		<CardArtTile
			imageUrl={card.imageUrl}
			alt={card.title}
			dimmed={status !== null}
			badge={
				<span className="flex gap-1">
					{status ? (
						<span className="rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[0.65rem] font-semibold text-amber-950">
							{status}
						</span>
					) : null}
					{inDeck > 0 ? (
						<span className="bg-selected text-selected-foreground rounded-full px-2 py-0.5 text-xs font-bold tabular-nums">
							{inDeck}×
						</span>
					) : null}
					<CountBadge
						owned={count}
						target={card.deckLimit}
						title={ownedTitle}
					/>
				</span>
			}
			overlay={
				<>
					<header className="flex flex-col gap-1">
						<div className="flex items-start justify-between gap-2">
							<h3 className="leading-tight font-bold">
								{card.nrdbPrintingId ? (
									<a
										href={`https://netrunnerdb.com/en/card/${card.nrdbPrintingId}`}
										target="_blank"
										rel="noreferrer"
										className="hover:underline"
									>
										{card.title}
									</a>
								) : (
									card.title
								)}
							</h3>
							<CountBadge
								owned={count}
								target={card.deckLimit}
								title={ownedTitle}
							/>
						</div>
						<p className="text-muted-foreground text-xs">
							<FactionDot factionId={card.factionId} /> {card.factionName} ·{' '}
							{card.typeName}
							{card.displaySubtypes ? `: ${card.displaySubtypes}` : ''}
						</p>
						<p className="text-muted-foreground flex items-center gap-2 text-xs">
							{card.influenceCost ? (
								<>
									Influence
									<InfluencePips
										influence={card.influenceCost}
										factionId={card.factionId}
									/>
								</>
							) : null}
							{card.agendaPoints !== null
								? `${card.agendaPoints} agenda points`
								: null}
						</p>
						{status ? (
							<p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
								{status}
							</p>
						) : null}
					</header>
					<div className="mt-auto flex flex-col gap-1">
						<span className="text-xs font-medium">In deck</span>
						<DeckQuantityStepper
							deckId={deck.id}
							cardId={card.id}
							title={card.title}
							quantity={saved}
							deckLimit={card.deckLimit}
						/>
					</div>
				</>
			}
		/>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => (
					<p>
						That deck doesn’t exist, or isn’t yours.{' '}
						<Link to="/decks" className="underline">
							Your decks
						</Link>
					</p>
				),
			}}
		/>
	)
}
