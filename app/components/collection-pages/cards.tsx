import {
	ArrowLeft,
	ArrowRight,
	Loading02,
	SearchMd,
	SearchRefraction,
	XClose,
} from '@untitledui/icons'
import { useEffect, useId, useRef, useState } from 'react'
import {
	Form,
	Link,
	type Location,
	useLocation,
	useNavigation,
	useNavigationType,
	useSearchParams,
	useSubmit,
} from 'react-router'
import { useSpinDelay } from 'spin-delay'
import {
	CardArtTile,
	CountBadge,
	OverlayCounters,
	VersionsButton,
} from '#app/components/card-art.tsx'
import {
	CollectionAccessProvider,
	useCollectionAccess,
} from '#app/components/collection-access-context.tsx'
import { CollectionNav, ShortcutHint } from '#app/components/collection-ui.tsx'
import { FactionDot, factionColor } from '#app/components/printing-tile.tsx'
import { Button, buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import {
	ToggleGroup,
	ToggleGroupItem,
} from '#app/components/ui/toggle-group.tsx'
import { type CardsPageData } from '#app/utils/collection-loaders.server.ts'
import { pickArtPrinting } from '#app/utils/collection.ts'
import { DECK_FORMAT_NAMES, DECK_FORMATS } from '#app/utils/deck-formats.ts'
import { cn, useDebounce } from '#app/utils/misc.tsx'

/** The search params that filter the list, i.e. everything but the page. */
function filtersOnly(searchParams: URLSearchParams) {
	const params = new URLSearchParams(searchParams)
	params.delete('page')
	return params.toString()
}

/** Navigations the filter form made itself carry this in `location.state`. */
const FROM_FILTERS = 'collection-filters'
function isFromFilters(location: Location) {
	return (location.state as { from?: unknown } | null)?.from === FROM_FILTERS
}

/** The Cards page, for your own collection or one shared with you. */
export function CardsPage({ loaderData }: { loaderData: CardsPageData }) {
	const {
		cards,
		inUse,
		total,
		page,
		pageCount,
		filters,
		totals,
		cardCount,
		access,
	} = loaderData
	const [searchParams] = useSearchParams()
	const location = useLocation()
	const navigation = useNavigation()
	const navigationType = useNavigationType()
	const featuredSetId = searchParams.get('set')

	// Searching, paging or clearing: the current cards stay up until the new
	// ones arrive. The dimmed overlay waits a moment so fast searches don't
	// flash.
	const isLoading =
		navigation.state === 'loading' &&
		navigation.location.pathname === location.pathname
	const showPending = useSpinDelay(isLoading, { delay: 300, minDuration: 300 })

	// The filter inputs are uncontrolled. When the filters change from outside
	// the form ("Clear filters", back/forward), remount it so the inputs match
	// the URL again. Its own searches don't, so typing is never interrupted.
	// Back and forward always do, whichever entry they land on.
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
		<CollectionAccessProvider value={access}>
			<main className="container mb-24 flex flex-col gap-6">
				<CollectionNav />
				<header className="flex flex-wrap items-end justify-between gap-2">
					<h1 className="text-h2">{collectionHeading(access)}</h1>
					<p className="text-muted-foreground text-sm">
						{totals.ownedCards.toLocaleString()} of {cardCount.toLocaleString()}{' '}
						cards · {totals.copies.toLocaleString()} copies
						{access.canEdit ? (
							<>
								{' · '}
								<Link
									to="/settings/profile/sharing"
									className="hover:text-foreground underline underline-offset-2"
								>
									Share…
								</Link>
							</>
						) : null}
					</p>
				</header>

				<Filters key={filtersForm.key} filters={filters} />

				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<p className="text-muted-foreground text-sm" aria-live="polite">
						{showPending
							? 'Searching…'
							: `${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'}`}
					</p>
					<ShortcutHint />
				</div>

				<div className="relative">
					{cards.length === 0 ? (
						<EmptyState hasCards={cardCount > 0} />
					) : (
						<ul
							aria-busy={isLoading}
							className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-4"
						>
							{cards.map((card) => (
								<li key={card.id}>
									<CardTile
										card={card}
										featuredSetId={featuredSetId}
										inUse={inUse[card.id] ?? 0}
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

				{pageCount > 1 ? (
					<Pagination page={page} pageCount={pageCount} />
				) : null}
			</main>
		</CollectionAccessProvider>
	)
}

/** "My collection", or "Kody's collection" when it's shared with you. */
export function collectionHeading({
	canEdit,
	ownerName,
}: {
	canEdit: boolean
	ownerName: string
}) {
	return canEdit ? 'My collection' : `${ownerName}’s collection`
}

function EmptyState({ hasCards }: { hasCards: boolean }) {
	const headingId = useId()
	const { canEdit, basePath } = useCollectionAccess()
	if (!hasCards) {
		return (
			<div className="bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
				<h2 className="font-semibold">No cards yet</h2>
				<p className="text-muted-foreground max-w-prose text-sm">
					The card list hasn’t been downloaded from NetrunnerDB yet. Cards show
					up here after the next sync.
				</p>
			</div>
		)
	}
	return (
		<section
			aria-labelledby={headingId}
			className="bg-muted/50 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center"
		>
			<Icon
				icon={SearchRefraction}
				size="lg"
				className="text-muted-foreground"
			/>
			<div className="flex flex-col gap-1">
				<h2 id={headingId} className="font-semibold">
					No cards match these filters
				</h2>
				<p className="text-muted-foreground max-w-prose text-sm">
					Try another name, or fewer filters.
					{canEdit
						? ' To add a whole collection at once, import it from a spreadsheet or NetrunnerDB.'
						: null}
				</p>
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<Link
					to={basePath}
					replace
					preventScrollReset
					className={buttonVariants()}
				>
					Clear filters
				</Link>
				{canEdit ? (
					<Link
						to="/collection/import-export"
						className={buttonVariants({ variant: 'outline' })}
					>
						Import cards
					</Link>
				) : null}
			</div>
		</section>
	)
}

type LoaderCard = CardsPageData['cards'][number]

function Filters({ filters }: { filters: CardsPageData['filters'] }) {
	const { basePath } = useCollectionAccess()
	const [searchParams] = useSearchParams()
	const submit = useSubmit()
	const id = useId()
	const searchRef = useRef<HTMLInputElement>(null)
	const formRef = useRef<HTMLFormElement>(null)
	// Toggles aren't form controls, so they're mirrored into hidden inputs and
	// submit the form themselves.
	const [sides, setSides] = useState(() =>
		searchParams.getAll('side').filter(Boolean),
	)
	const [factions, setFactions] = useState(() =>
		searchParams.getAll('faction').filter(Boolean),
	)
	// With no side picked, every faction can be; otherwise only the ones that
	// have cards on a picked side.
	const inPickedSides = (
		toggle: (typeof filters.factionToggles)[number],
		picked = sides,
	) =>
		picked.length === 0 ||
		toggle.factions.some((f) => picked.includes(f.sideId))

	// "/" jumps to the search box. It isn't autofocused, so that card
	// shortcuts work as soon as the page loads.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== '/' || event.metaKey || event.ctrlKey) return
			const target = event.target as HTMLElement | null
			if (target?.closest('input, textarea, select, [contenteditable]')) return
			event.preventDefault()
			searchRef.current?.focus()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [])
	// Submit only the filters that are set, so URLs stay short and shareable.
	function submitFilters(form: HTMLFormElement) {
		const params = new URLSearchParams()
		for (const [key, value] of new FormData(form)) {
			if (typeof value === 'string' && value !== '') params.append(key, value)
		}
		// already showing these results (e.g. Enter after the debounced search)
		if (params.toString() === searchParams.toString()) return
		void submit(params, {
			method: 'GET',
			action: basePath,
			replace: true,
			preventScrollReset: true,
			state: { from: FROM_FILTERS },
		})
	}
	const autoSubmit = useDebounce(submitFilters, 300)
	const hasFilters = filtersOnly(searchParams) !== ''

	return (
		<Form
			ref={formRef}
			method="GET"
			action={basePath}
			className="bg-muted flex flex-col gap-3 rounded-lg p-4"
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
					placeholder="Search cards by name (press / )"
					defaultValue={searchParams.get('q') ?? ''}
					ref={searchRef}
					onKeyDown={(e) => {
						if (e.key === 'Escape') e.currentTarget.blur()
					}}
					autoComplete="off"
				/>
				<Button type="submit" size="icon" aria-label="Search">
					<Icon icon={SearchMd} size="sm" />
				</Button>
				{/* always here, so the panel doesn't jump when filters are set */}
				{hasFilters ? (
					<Link
						to={basePath}
						replace
						preventScrollReset
						aria-label="Clear filters"
						className={cn(
							buttonVariants({ variant: 'outline' }),
							clearClassName,
						)}
					>
						<Icon icon={XClose} size="sm" />
						<span className="max-sm:hidden">Clear</span>
					</Link>
				) : (
					<Button
						type="button"
						variant="outline"
						disabled
						aria-label="Clear filters"
						className={clearClassName}
					>
						<Icon icon={XClose} size="sm" />
						<span className="max-sm:hidden">Clear</span>
					</Button>
				)}
			</div>
			<div className="flex flex-wrap gap-x-6 gap-y-3">
				<ToggleFilter label="Side">
					<ToggleGroup
						aria-label="Side"
						variant="outline"
						multiple
						value={sides}
						onValueChange={(value: string[]) => {
							setSides(value)
							// drop factions the picked sides don't have
							setFactions((current) =>
								current.filter((faction) => {
									const toggle = filters.factionToggles.find(
										(t) => t.value === faction,
									)
									return !toggle || inPickedSides(toggle, value)
								}),
							)
							if (formRef.current) autoSubmit(formRef.current)
						}}
					>
						<ToggleGroupItem value="corp" className={toggleClassName}>
							Corp
						</ToggleGroupItem>
						<ToggleGroupItem value="runner" className={toggleClassName}>
							Runner
						</ToggleGroupItem>
					</ToggleGroup>
				</ToggleFilter>
				<ToggleFilter label="Faction">
					<ToggleGroup
						aria-label="Faction"
						variant="outline"
						multiple
						className="flex-wrap"
						value={factions}
						onValueChange={(value: string[]) => {
							setFactions(value)
							if (formRef.current) autoSubmit(formRef.current)
						}}
					>
						{filters.factionToggles.map((toggle) => {
							const colors = [
								...new Set(toggle.factions.map((f) => factionColor(f.id))),
							]
							return (
								<ToggleGroupItem
									key={toggle.value}
									value={toggle.value}
									disabled={!inPickedSides(toggle)}
									title={
										toggle.factions.length > 1
											? toggle.factions.map((f) => f.name).join(', ')
											: undefined
									}
									style={
										{
											// a group's own color would be arbitrary
											'--faction':
												colors.length === 1 ? colors[0] : 'var(--foreground)',
										} as React.CSSProperties
									}
									className={cn(toggleClassName, factionToggleClassName)}
								>
									<span aria-hidden className="flex shrink-0">
										{colors.map((color) => (
											<span
												key={color}
												style={{ '--dot': color } as React.CSSProperties}
												className="ring-background size-2.5 rounded-full bg-(--dot) transition-colors not-first:-ml-1 not-only:ring-1 group-disabled/toggle:bg-current"
											/>
										))}
									</span>
									{toggle.name}
								</ToggleGroupItem>
							)
						})}
					</ToggleGroup>
				</ToggleFilter>
				{sides.map((side) => (
					<input key={side} type="hidden" name="side" value={side} />
				))}
				{factions.map((id) => (
					<input key={id} type="hidden" name="faction" value={id} />
				))}
			</div>
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
				<FilterSelect name="format" label="Format" searchParams={searchParams}>
					{DECK_FORMATS.map((id) => (
						<NativeSelectOption key={id} value={id}>
							{DECK_FORMAT_NAMES[id]}
						</NativeSelectOption>
					))}
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
		</Form>
	)
}

const clearClassName = 'bg-background dark:bg-input/30 shrink-0'

// On the muted filter panel, toggles sit on the page background like the
// selects, and a pressed one fills in.
const toggleClassName =
	'bg-background hover:bg-background dark:bg-input/30 dark:hover:bg-input/50 aria-pressed:border-selected aria-pressed:bg-selected aria-pressed:text-selected-foreground aria-pressed:hover:bg-selected/85 aria-pressed:hover:text-selected-foreground dark:aria-pressed:bg-selected dark:aria-pressed:hover:bg-selected/85'
// Faction toggles take their faction's color (`--faction`) instead.
const factionToggleClassName =
	'hover:border-(--faction) aria-pressed:border-(--faction) aria-pressed:bg-(--faction)/15 aria-pressed:text-foreground aria-pressed:hover:bg-(--faction)/25 aria-pressed:hover:text-foreground dark:aria-pressed:bg-(--faction)/25'

function ToggleFilter({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) {
	return (
		<div className="flex flex-col gap-1">
			<span aria-hidden className="text-muted-foreground text-xs">
				{label}
			</span>
			{children}
		</div>
	)
}

export function FilterSelect({
	name,
	label,
	allLabel = `Any ${label.toLowerCase()}`,
	searchParams,
	children,
}: {
	name: string
	label: string
	allLabel?: string
	searchParams: URLSearchParams
	children: React.ReactNode
}) {
	const id = useId()
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id} className="text-muted-foreground text-xs">
				{label}
			</Label>
			<NativeSelect
				id={id}
				name={name}
				defaultValue={searchParams.get(name) ?? ''}
				className="w-full"
			>
				<NativeSelectOption value="">{allLabel}</NativeSelectOption>
				{children}
			</NativeSelect>
		</div>
	)
}

function CardTile({
	card,
	featuredSetId,
	inUse,
}: {
	card: LoaderCard
	/** When filtering by set, show that set's art rather than the newest. */
	featuredSetId: string | null
	/** copies your filled decks hold */
	inUse: number
}) {
	const owned = card.printings.reduce(
		(sum, p) =>
			sum +
			(p.collectionEntries[0]?.quantity ?? 0) +
			p.variants.reduce((vSum, v) => vSum + v.quantity, 0),
		0,
	)
	const preferredId = card.preferredArt[0]?.printingId ?? null
	const featured =
		card.printings.find((p) => p.set.id === featuredSetId) ??
		pickArtPrinting(card.printings, preferredId)
	const labelFor = (p: LoaderCard['printings'][number]) =>
		`${card.title} (${p.set.name})`
	const countTitle =
		inUse > 0 ? `You own ${owned}; ${inUse} in use by your decks` : undefined

	return (
		<CardArtTile
			imageUrl={featured?.imageLarge ?? featured?.imageSmall ?? null}
			alt={card.title}
			dimmed={owned === 0}
			badge={<CountBadge owned={owned} title={countTitle} />}
			overlay={
				<>
					<header className="flex flex-col gap-1">
						<div className="flex items-start justify-between gap-2">
							<h2 className="leading-tight font-bold">
								<a
									href={`https://netrunnerdb.com/en/card/${card.printings[0]?.id ?? ''}`}
									target="_blank"
									rel="noreferrer"
									className="hover:underline"
								>
									{card.title}
								</a>
							</h2>
							<CountBadge owned={owned} title={countTitle} />
						</div>
						<p className="text-muted-foreground text-xs">
							<FactionDot factionId={card.faction.id} /> {card.faction.name} ·{' '}
							{card.type.name}
							{card.displaySubtypes ? `: ${card.displaySubtypes}` : ''}
						</p>
						{/* a deck building limit, not a collection target */}
						<p className="text-muted-foreground text-xs">
							Deck limit {card.deckLimit}
							{inUse > 0 ? ` · ${inUse} in use by your decks` : ''}
						</p>
					</header>
					<ul className="flex flex-col gap-2">
						{card.printings.map((printing) => (
							<li key={printing.id}>
								<OverlayCounters
									printing={printing}
									label={labelFor(printing)}
									heading={printing.set.name}
									primary={printing.id === featured?.id}
								/>
							</li>
						))}
					</ul>
					<VersionsButton
						title={card.title}
						printings={card.printings.map((printing) => ({
							printing,
							label: labelFor(printing),
							heading: printing.set.name,
						}))}
						defaultArt={{ cardId: card.id, printingId: preferredId }}
					/>
				</>
			}
		/>
	)
}

export function Pagination({
	page,
	pageCount,
}: {
	page: number
	pageCount: number
}) {
	const [searchParams] = useSearchParams()
	function pageLink(n: number) {
		const params = new URLSearchParams(searchParams)
		params.set('page', String(n))
		return `?${params}`
	}
	return (
		<nav className="flex items-center justify-center gap-4" aria-label="Pages">
			{page > 1 ? (
				<Link
					to={pageLink(page - 1)}
					preventScrollReset
					className={buttonVariants({ variant: 'outline' })}
				>
					<Icon icon={ArrowLeft}>Previous</Icon>
				</Link>
			) : null}
			<span className="text-muted-foreground text-sm">
				Page {page} of {pageCount}
			</span>
			{page < pageCount ? (
				<Link
					to={pageLink(page + 1)}
					preventScrollReset
					className={buttonVariants({ variant: 'outline' })}
				>
					Next <Icon icon={ArrowRight} />
				</Link>
			) : null}
		</nav>
	)
}
