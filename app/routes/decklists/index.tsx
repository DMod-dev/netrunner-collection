import { SearchMd, XClose } from '@untitledui/icons'
import { useId, useState } from 'react'
import {
	Form,
	Link,
	type Location,
	useLocation,
	useNavigationType,
	useSearchParams,
	useSubmit,
} from 'react-router'
import {
	FilterSelect,
	Pagination,
} from '#app/components/collection-pages/cards.tsx'
import { DeckSummaryCard } from '#app/components/deck-summary-card.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button, buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelectOptGroup,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import { DECK_FORMAT_NAMES, DECK_FORMATS } from '#app/utils/deck-formats.ts'
import {
	getIdentityFactions,
	searchPublicDecks,
} from '#app/utils/deck.server.ts'
import { DECK_SIDES } from '#app/utils/deck.ts'
import { cn, pageTitle, useDebounce } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

const SIDE_NAMES = { corp: 'Corp', runner: 'Runner' } as const

/** Everyone's public decks, searchable without signing in. */
export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const get = (key: string) => url.searchParams.get(key) || undefined
	const side = DECK_SIDES.find((s) => s === get('side'))
	const formatId = DECK_FORMATS.find((f) => f === get('format'))
	const [results, factions] = await Promise.all([
		searchPublicDecks({
			q: get('q'),
			side,
			factionId: get('faction'),
			formatId,
			author: get('author'),
			page: Number(get('page')) || 1,
		}),
		getIdentityFactions(),
	])
	return { ...results, factions }
}

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Decklists') },
	{
		name: 'description',
		content: 'Search everyone’s public Netrunner decklists.',
	},
]

/** The search params that make up a search, i.e. everything but the page. */
function searchOnly(searchParams: URLSearchParams) {
	const params = new URLSearchParams(searchParams)
	params.delete('page')
	return params.toString()
}

const FROM_SEARCH = 'decklist-search'
function isFromSearch(location: Location) {
	return (location.state as { from?: unknown } | null)?.from === FROM_SEARCH
}

export default function DecklistsRoute({ loaderData }: Route.ComponentProps) {
	const { decks, total, page, pageCount, factions } = loaderData
	const [searchParams] = useSearchParams()
	const location = useLocation()
	const navigationType = useNavigationType()
	const author = searchParams.get('author')
	const withoutAuthor = new URLSearchParams(searchParams)
	withoutAuthor.delete('author')
	withoutAuthor.delete('page')

	// The inputs are uncontrolled. When the search changes from outside the
	// form (clearing it, an author link, back/forward), remount it so they
	// match the URL again. Its own searches don't, so typing isn't interrupted.
	const search = searchOnly(searchParams)
	const [form, setForm] = useState({ search, key: 0 })
	if (form.search !== search) {
		setForm({
			search,
			key:
				navigationType !== 'POP' && isFromSearch(location)
					? form.key
					: form.key + 1,
		})
	}
	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-h2">Decklists</h1>
				<p className="text-muted-foreground max-w-prose">
					Everyone’s public decks. Search by deck name, identity, card or
					player.
				</p>
			</header>
			<SearchForm key={form.key} factions={factions} />
			<p role="status" className="text-muted-foreground text-sm tabular-nums">
				{total} {total === 1 ? 'deck' : 'decks'}
				{author ? (
					<>
						{' '}
						by <span className="text-foreground font-medium">
							{author}
						</span>{' '}
						<Link
							to={`?${withoutAuthor}`}
							replace
							preventScrollReset
							className="hover:text-foreground underline"
						>
							Any player
						</Link>
					</>
				) : null}
			</p>
			{decks.length ? (
				<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{decks.map((deck) => (
						<li key={deck.id}>
							<DeckSummaryCard
								deck={deck}
								byline={deck.owner.name ?? deck.owner.username}
							/>
						</li>
					))}
				</ul>
			) : (
				<div className="bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
					<h2 className="font-semibold">No decks found</h2>
					<p className="text-muted-foreground max-w-prose text-sm">
						Try fewer words, or clear the filters.
					</p>
				</div>
			)}
			{pageCount > 1 ? <Pagination page={page} pageCount={pageCount} /> : null}
		</main>
	)
}

function SearchForm({
	factions,
}: {
	factions: Route.ComponentProps['loaderData']['factions']
}) {
	const [searchParams] = useSearchParams()
	const location = useLocation()
	const submit = useSubmit()
	const id = useId()
	// the form remounts when the search changes from outside it, so the
	// input only needs the URL's value once
	const [initialQuery] = useState(() => searchParams.get('q') ?? '')

	// Submit only what's set, so URLs stay short; a new search starts on
	// page 1.
	function submitSearch(form: HTMLFormElement) {
		const params = new URLSearchParams()
		for (const [key, value] of new FormData(form)) {
			if (typeof value === 'string' && value !== '') params.append(key, value)
		}
		if (params.toString() === searchOnly(searchParams)) return
		void submit(params, {
			method: 'GET',
			action: location.pathname,
			replace: true,
			preventScrollReset: true,
			state: { from: FROM_SEARCH },
		})
	}
	const autoSubmit = useDebounce(submitSearch, 300)
	const hasFilters = [...searchParams.keys()].some((key) => key !== 'page')
	const author = searchParams.get('author')

	return (
		<Form
			method="GET"
			role="search"
			className="bg-muted flex flex-col gap-3 rounded-lg p-3"
			onChange={(e) => autoSubmit(e.currentTarget)}
			onSubmit={(e) => {
				e.preventDefault()
				autoSubmit.cancel()
				submitSearch(e.currentTarget)
			}}
		>
			<div className="flex gap-2">
				<Label htmlFor={`${id}-q`} className="sr-only">
					Search decks
				</Label>
				<Input
					id={`${id}-q`}
					type="search"
					name="q"
					placeholder="Deck, identity, card or player"
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
						aria-label="Clear search"
						className={cn(
							buttonVariants({ variant: 'outline' }),
							'bg-background shrink-0',
						)}
					>
						<Icon icon={XClose} size="sm" />
					</Link>
				) : null}
			</div>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
				<FilterSelect name="side" label="Side" searchParams={searchParams}>
					{DECK_SIDES.map((side) => (
						<NativeSelectOption key={side} value={side}>
							{SIDE_NAMES[side]}
						</NativeSelectOption>
					))}
				</FilterSelect>
				<FilterSelect
					name="faction"
					label="Faction"
					searchParams={searchParams}
				>
					{DECK_SIDES.map((side) => (
						<NativeSelectOptGroup key={side} label={SIDE_NAMES[side]}>
							{factions
								.filter((f) => f.sideId === side)
								.map((f) => (
									<NativeSelectOption key={f.id} value={f.id}>
										{f.name}
									</NativeSelectOption>
								))}
						</NativeSelectOptGroup>
					))}
				</FilterSelect>
				<FilterSelect name="format" label="Format" searchParams={searchParams}>
					{DECK_FORMATS.map((f) => (
						<NativeSelectOption key={f} value={f}>
							{DECK_FORMAT_NAMES[f]}
						</NativeSelectOption>
					))}
				</FilterSelect>
			</div>
			{author ? (
				// kept while searching; "Any player" or the ✕ clears it
				<input type="hidden" name="author" value={author} />
			) : null}
		</Form>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
