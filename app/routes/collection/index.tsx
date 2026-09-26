import {
	ArrowLeft,
	ArrowRight,
	Loading02,
	SearchMd,
	SearchRefraction,
} from '@untitledui/icons'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
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
import { CollectionNav, ShortcutHint } from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot } from '#app/components/printing-tile.tsx'
import { Button, buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelect,
	NativeSelectOptGroup,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	type CardSearchParams,
	getCardCount,
	getFilterOptions,
	searchCards,
} from '#app/utils/collection.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { useDebounce } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const FORMATS = [
	{ id: 'standard', name: 'Standard' },
	{ id: 'startup', name: 'Startup' },
	{ id: 'eternal', name: 'Eternal' },
] as const

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const get = (key: string) => url.searchParams.get(key) || undefined
	const owned = get('owned')
	const params: CardSearchParams = {
		q: get('q'),
		side: get('side'),
		faction: get('faction'),
		type: get('type'),
		set: get('set'),
		format: get('format'),
		owned: owned === 'owned' || owned === 'missing' ? owned : undefined,
		page: Number(get('page')) || 1,
	}

	const [results, filters, totals, cardCount] = await Promise.all([
		searchCards(userId, params),
		getFilterOptions(),
		getCollectionTotals(userId),
		getCardCount(),
	])
	return { ...results, filters, totals, cardCount }
}

async function getCollectionTotals(userId: string) {
	const [entries, variants, ownedCards] = await Promise.all([
		prisma.collectionEntry.aggregate({
			where: { userId },
			_sum: { quantity: true },
		}),
		prisma.variant.aggregate({
			where: { userId },
			_sum: { quantity: true },
		}),
		prisma.card.count({
			where: {
				printings: {
					some: {
						OR: [
							{ collectionEntries: { some: { userId, quantity: { gt: 0 } } } },
							{ variants: { some: { userId, quantity: { gt: 0 } } } },
						],
					},
				},
			},
		}),
	])
	return {
		copies: (entries._sum.quantity ?? 0) + (variants._sum.quantity ?? 0),
		ownedCards,
	}
}

export const meta: Route.MetaFunction = () => [
	{ title: 'My Collection | Netrunner Collection' },
]

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

export default function CollectionRoute({ loaderData }: Route.ComponentProps) {
	const { cards, total, page, pageCount, filters, totals, cardCount } =
		loaderData
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
		<main className="container mb-24 flex flex-col gap-6">
			<CollectionNav />
			<header className="flex flex-wrap items-end justify-between gap-2">
				<h1 className="text-h2">My collection</h1>
				<p className="text-muted-foreground text-sm">
					{totals.ownedCards.toLocaleString()} of {cardCount.toLocaleString()}{' '}
					cards · {totals.copies.toLocaleString()} copies
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
								<CardTile card={card} featuredSetId={featuredSetId} />
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

			{pageCount > 1 ? <Pagination page={page} pageCount={pageCount} /> : null}
		</main>
	)
}

function EmptyState({ hasCards }: { hasCards: boolean }) {
	const headingId = useId()
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
					Try another name, or fewer filters. To add a whole collection at once,
					import it from a spreadsheet or NetrunnerDB.
				</p>
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<Link
					to="/collection"
					replace
					preventScrollReset
					className={buttonVariants()}
				>
					Clear filters
				</Link>
				<Link
					to="/collection/import-export"
					className={buttonVariants({ variant: 'outline' })}
				>
					Import cards
				</Link>
			</div>
		</section>
	)
}

type LoaderCard = Route.ComponentProps['loaderData']['cards'][number]

function Filters({
	filters,
}: {
	filters: Route.ComponentProps['loaderData']['filters']
}) {
	const [searchParams] = useSearchParams()
	const submit = useSubmit()
	const id = useId()
	const searchRef = useRef<HTMLInputElement>(null)
	// Factions are listed for the side picked in the form, not the one in the
	// URL, so changing sides drops a faction from the other side before the
	// search runs (a <select> whose option is removed falls back to "Any").
	const [side, setSide] = useState(searchParams.get('side') ?? '')

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
			if (typeof value === 'string' && value !== '') params.set(key, value)
		}
		// already showing these results (e.g. Enter after the debounced search)
		if (params.toString() === searchParams.toString()) return
		void submit(params, {
			method: 'GET',
			action: '/collection',
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
			action="/collection"
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
			</div>
			<div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
				<FilterSelect
					name="side"
					label="Side"
					searchParams={searchParams}
					onChange={(e) => setSide(e.currentTarget.value)}
				>
					<NativeSelectOption value="corp">Corp</NativeSelectOption>
					<NativeSelectOption value="runner">Runner</NativeSelectOption>
				</FilterSelect>
				<FilterSelect
					name="faction"
					label="Faction"
					searchParams={searchParams}
				>
					{filters.factions
						.filter((f) => !side || f.sideId === side)
						.map((f) => (
							<NativeSelectOption key={f.id} value={f.id}>
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
				<FilterSelect name="format" label="Format" searchParams={searchParams}>
					{FORMATS.map((f) => (
						<NativeSelectOption key={f.id} value={f.id}>
							{f.name}
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
			{hasFilters ? (
				<Link
					to="/collection"
					replace
					preventScrollReset
					className="text-muted-foreground self-start text-sm underline"
				>
					Clear filters
				</Link>
			) : null}
		</Form>
	)
}

function FilterSelect({
	name,
	label,
	allLabel = `Any ${label.toLowerCase()}`,
	searchParams,
	onChange,
	children,
}: {
	name: string
	label: string
	allLabel?: string
	searchParams: URLSearchParams
	onChange?: React.ChangeEventHandler<HTMLSelectElement>
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
				onChange={onChange}
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
}: {
	card: LoaderCard
	/** When filtering by set, show that set's art rather than the newest. */
	featuredSetId: string | null
}) {
	const owned = card.printings.reduce(
		(sum, p) =>
			sum +
			(p.collectionEntries[0]?.quantity ?? 0) +
			p.variants.reduce((vSum, v) => vSum + v.quantity, 0),
		0,
	)
	const featured =
		card.printings.find((p) => p.set.id === featuredSetId) ?? card.printings[0]
	const labelFor = (p: LoaderCard['printings'][number]) =>
		`${card.title} (${p.set.name})`

	return (
		<CardArtTile
			imageUrl={featured?.imageLarge ?? featured?.imageSmall ?? null}
			alt={card.title}
			dimmed={owned === 0}
			badge={<CountBadge owned={owned} target={card.deckLimit} />}
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
							<CountBadge
								owned={owned}
								target={card.deckLimit}
								title={`You own ${owned} (deck limit ${card.deckLimit})`}
							/>
						</div>
						<p className="text-muted-foreground text-xs">
							<FactionDot factionId={card.faction.id} /> {card.faction.name} ·{' '}
							{card.type.name}
							{card.displaySubtypes ? `: ${card.displaySubtypes}` : ''}
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
					/>
				</>
			}
		/>
	)
}

function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
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

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
