import { useId, useRef, useState } from 'react'
import { Form, Link, useSearchParams, useSubmit } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	AddVariantForm,
	DeleteVariantButton,
	QuantityStepper,
} from '#app/routes/resources/collection.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	type CardSearchParams,
	getFilterOptions,
	searchCards,
} from '#app/utils/collection.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn, useDebounce, useDelayedIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

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
		prisma.card.count(),
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

export default function CollectionRoute({ loaderData }: Route.ComponentProps) {
	const { cards, total, page, pageCount, filters, totals, cardCount } =
		loaderData
	const isPending = useDelayedIsPending({
		formMethod: 'GET',
		formAction: '/collection',
	})

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-wrap items-end justify-between gap-2">
				<h1 className="text-h2">My collection</h1>
				<p className="text-muted-foreground text-sm">
					{totals.ownedCards.toLocaleString()} of {cardCount.toLocaleString()}{' '}
					cards · {totals.copies.toLocaleString()} copies
				</p>
			</header>

			<Filters filters={filters} />

			<p className="text-muted-foreground text-sm" aria-live="polite">
				{total === 0
					? 'No cards match these filters.'
					: `${total.toLocaleString()} ${total === 1 ? 'card' : 'cards'}`}
			</p>

			<ul
				className={cn('flex flex-col gap-4 transition-opacity', {
					'opacity-50': isPending,
				})}
			>
				{cards.map((card) => (
					<li key={card.id}>
						<CardRow card={card} />
					</li>
				))}
			</ul>

			{pageCount > 1 ? <Pagination page={page} pageCount={pageCount} /> : null}
		</main>
	)
}

type LoaderCard = Route.ComponentProps['loaderData']['cards'][number]
type LoaderPrinting = LoaderCard['printings'][number]

function Filters({
	filters,
}: {
	filters: Route.ComponentProps['loaderData']['filters']
}) {
	const [searchParams] = useSearchParams()
	const submit = useSubmit()
	const id = useId()
	const formRef = useRef<HTMLFormElement>(null)
	// Submit only the filters that are set, so URLs stay short and shareable.
	function submitFilters(form: HTMLFormElement) {
		const params = new URLSearchParams()
		for (const [key, value] of new FormData(form)) {
			if (typeof value === 'string' && value !== '') params.set(key, value)
		}
		void submit(params, {
			method: 'GET',
			action: '/collection',
			replace: true,
			preventScrollReset: true,
		})
	}
	const autoSubmit = useDebounce(submitFilters, 300)
	const side = searchParams.get('side') ?? ''
	const hasFilters = [...searchParams.keys()].some((key) => key !== 'page')

	return (
		<Form
			ref={formRef}
			method="GET"
			action="/collection"
			className="bg-muted flex flex-col gap-3 rounded-lg p-4"
			onChange={(e) => autoSubmit(e.currentTarget)}
			onSubmit={(e) => {
				e.preventDefault()
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
					defaultValue={searchParams.get('q') ?? ''}
					autoFocus
					autoComplete="off"
				/>
				<Button type="submit" aria-label="Search">
					<Icon name="magnifying-glass" size="md" />
				</Button>
			</div>
			<div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
				<FilterSelect name="side" label="Side" searchParams={searchParams}>
					<option value="corp">Corp</option>
					<option value="runner">Runner</option>
				</FilterSelect>
				<FilterSelect
					name="faction"
					label="Faction"
					searchParams={searchParams}
				>
					{filters.factions
						.filter((f) => !side || f.sideId === side)
						.map((f) => (
							<option key={f.id} value={f.id}>
								{f.name}
							</option>
						))}
				</FilterSelect>
				<FilterSelect name="type" label="Type" searchParams={searchParams}>
					{filters.types.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name}
						</option>
					))}
				</FilterSelect>
				<FilterSelect name="set" label="Set" searchParams={searchParams}>
					{filters.cycles.map((cycle) =>
						cycle.sets.length === 1 && cycle.sets[0]!.name === cycle.name ? (
							<option key={cycle.id} value={cycle.sets[0]!.id}>
								{cycle.name}
							</option>
						) : (
							<optgroup key={cycle.id} label={cycle.name}>
								{cycle.sets.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</optgroup>
						),
					)}
				</FilterSelect>
				<FilterSelect name="format" label="Format" searchParams={searchParams}>
					{FORMATS.map((f) => (
						<option key={f.id} value={f.id}>
							{f.name}
						</option>
					))}
				</FilterSelect>
				<FilterSelect
					name="owned"
					label="Owned"
					allLabel="Owned or not"
					searchParams={searchParams}
				>
					<option value="owned">Owned</option>
					<option value="missing">Not owned</option>
				</FilterSelect>
			</div>
			{hasFilters ? (
				<Link
					to="/collection"
					className="text-muted-foreground self-start text-sm underline"
					onClick={() => {
						// inputs are uncontrolled, so clear them to match the new URL
						formRef.current
							?.querySelectorAll<
								HTMLInputElement | HTMLSelectElement
							>('input, select')
							.forEach((el) => (el.value = ''))
					}}
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
			<select
				id={id}
				name={name}
				defaultValue={searchParams.get(name) ?? ''}
				className="border-input bg-background h-9 rounded-md border px-2 text-sm"
			>
				<option value="">{allLabel}</option>
				{children}
			</select>
		</div>
	)
}

function CardRow({ card }: { card: LoaderCard }) {
	const owned = card.printings.reduce(
		(sum, p) =>
			sum +
			(p.collectionEntries[0]?.quantity ?? 0) +
			p.variants.reduce((vSum, v) => vSum + v.quantity, 0),
		0,
	)
	const hasPlayset = owned >= card.deckLimit

	return (
		<article className="border-border flex flex-col gap-3 rounded-lg border p-4">
			<header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<div className="flex flex-col">
					<h2 className="text-lg font-bold">
						<a
							href={`https://netrunnerdb.com/en/card/${card.printings[0]?.id ?? ''}`}
							target="_blank"
							rel="noreferrer"
							className="hover:underline"
						>
							{card.title}
						</a>
					</h2>
					<p className="text-muted-foreground text-sm">
						<FactionDot factionId={card.faction.id} /> {card.faction.name} ·{' '}
						{card.type.name}
						{card.displaySubtypes ? `: ${card.displaySubtypes}` : ''}
					</p>
				</div>
				<span
					className={cn(
						'rounded-full px-3 py-1 text-sm font-bold tabular-nums',
						owned === 0
							? 'bg-muted text-muted-foreground'
							: hasPlayset
								? 'bg-primary text-primary-foreground'
								: 'bg-secondary text-secondary-foreground',
					)}
					title={`You own ${owned} (deck limit ${card.deckLimit})`}
				>
					{owned} / {card.deckLimit}
				</span>
			</header>
			<ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
				{card.printings.map((printing) => (
					<li key={printing.id}>
						<PrintingTile printing={printing} cardTitle={card.title} />
					</li>
				))}
			</ul>
		</article>
	)
}

function PrintingTile({
	printing,
	cardTitle,
}: {
	printing: LoaderPrinting
	cardTitle: string
}) {
	const [addingVariant, setAddingVariant] = useState(false)
	const quantity = printing.collectionEntries[0]?.quantity ?? 0
	const label = `${cardTitle} (${printing.set.name})`

	return (
		<div className="bg-muted/50 flex h-full flex-col gap-2 rounded-md p-2">
			<div className="flex gap-2">
				{printing.imageSmall ? (
					<a
						href={printing.imageLarge ?? printing.imageSmall}
						target="_blank"
						rel="noreferrer"
						className="shrink-0"
					>
						<img
							src={printing.imageSmall}
							alt={label}
							loading="lazy"
							width={60}
							height={84}
							className="h-[84px] w-[60px] rounded object-cover"
						/>
					</a>
				) : null}
				<div className="flex min-w-0 flex-col text-xs">
					<span className="font-semibold">{printing.set.name}</span>
					<span className="text-muted-foreground">
						#{printing.position}
						{printing.illustrator ? ` · ${printing.illustrator}` : ''}
					</span>
				</div>
			</div>
			<QuantityStepper
				target={{ printingId: printing.id }}
				quantity={quantity}
				label={label}
			/>
			{printing.variants.length ? (
				<ul className="border-border flex flex-col gap-1 border-t pt-2">
					{printing.variants.map((variant) => (
						<li key={variant.id} className="flex flex-col gap-1">
							<div className="flex items-center justify-between gap-1">
								<span
									className="truncate text-xs font-medium"
									title={variant.label}
								>
									{variant.label}
								</span>
								<DeleteVariantButton
									variantId={variant.id}
									label={variant.label}
								/>
							</div>
							<QuantityStepper
								target={{ variantId: variant.id }}
								quantity={variant.quantity}
								label={`${label} – ${variant.label}`}
								size="sm"
							/>
						</li>
					))}
				</ul>
			) : null}
			{addingVariant ? (
				<AddVariantForm
					printingId={printing.id}
					onDone={() => setAddingVariant(false)}
				/>
			) : (
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground mt-auto self-start text-xs underline"
					onClick={() => setAddingVariant(true)}
				>
					+ Alt art / other version
				</button>
			)}
		</div>
	)
}

const FACTION_COLORS: Record<string, string> = {
	anarch: '#e46d19',
	criminal: '#3b6bd8',
	shaper: '#3fa63f',
	haas_bioroid: '#8a3aa6',
	jinteki: '#c7303b',
	nbn: '#e6b800',
	weyland_consortium: '#2d6d54',
	adam: '#b4a153',
	apex: '#9e3a3a',
	sunny_lebeau: '#6d6d6d',
	neutral_corp: '#8a8a8a',
	neutral_runner: '#8a8a8a',
}

function FactionDot({ factionId }: { factionId: string }) {
	return (
		<span
			aria-hidden
			className="inline-block size-2.5 rounded-full align-middle"
			style={{ backgroundColor: FACTION_COLORS[factionId] ?? '#8a8a8a' }}
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
				<Button asChild variant="outline">
					<Link to={pageLink(page - 1)}>
						<Icon name="arrow-left">Previous</Icon>
					</Link>
				</Button>
			) : null}
			<span className="text-muted-foreground text-sm">
				Page {page} of {pageCount}
			</span>
			{page < pageCount ? (
				<Button asChild variant="outline">
					<Link to={pageLink(page + 1)}>
						Next <Icon name="arrow-right" />
					</Link>
				</Button>
			) : null}
		</nav>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
