import { ArrowLeft } from '@untitledui/icons'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	type ShouldRevalidateFunctionArgs,
	Link,
	useNavigate,
	useSearchParams,
} from 'react-router'
import {
	CardArtTile,
	CountBadge,
	OverlayCounters,
	VersionsButton,
} from '#app/components/card-art.tsx'
import {
	CollectionNav,
	ShortcutHint,
	formatPercent,
	formatSetType,
	ProgressBar,
	TargetToggle,
} from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot } from '#app/components/printing-tile.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Switch } from '#app/components/ui/switch.tsx'
import { AddProductForm } from '#app/routes/resources/collection.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getSetCompletion,
	parseCompletionTarget,
} from '#app/utils/collection.server.ts'
import { formatMonthYear } from '#app/utils/dates.ts'
import { type Route } from './+types/$setId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const target = parseCompletionTarget(
		new URL(request.url).searchParams.get('target'),
	)
	const set = await getSetCompletion(userId, params.setId, target)
	invariantResponse(set, 'Set not found', { status: 404 })
	return { target, set }
}

// "Only show missing cards" filters on the client, so toggling it doesn't
// need a round trip
export function shouldRevalidate({
	currentUrl,
	nextUrl,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	const withoutShow = (url: URL) => {
		const params = new URLSearchParams(url.search)
		params.delete('show')
		return `${url.pathname}?${params}`
	}
	if (
		currentUrl.search !== nextUrl.search &&
		withoutShow(currentUrl) === withoutShow(nextUrl)
	) {
		return false
	}
	return defaultShouldRevalidate
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
	{
		title: `${loaderData?.set.name ?? 'Set'} | Netrunner Collection`,
	},
]

export default function SetRoute({ loaderData }: Route.ComponentProps) {
	const { target, set } = loaderData
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const missingOnly = searchParams.get('show') === 'missing'
	const printings = missingOnly
		? set.printings.filter((p) => p.progress.have < p.progress.need)
		: set.printings
	const missingCount = set.printings.filter(
		(p) => p.progress.have < p.progress.need,
	).length

	function setMissingOnly(checked: boolean) {
		const params = new URLSearchParams(searchParams)
		if (checked) params.set('show', 'missing')
		else params.delete('show')
		const query = params.toString()
		void navigate(
			{ search: query ? `?${query}` : '' },
			{ replace: true, preventScrollReset: true },
		)
	}

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<CollectionNav />
			<div className="flex flex-col gap-1">
				<Link
					to={target === 'product' ? '..' : `..?target=${target}`}
					relative="path"
					className="text-muted-foreground hover:text-foreground self-start text-sm"
				>
					<Icon icon={ArrowLeft}>All sets</Icon>
				</Link>
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="text-h2">{set.name}</h1>
						<p className="text-muted-foreground text-sm">
							{set.cycle.name !== set.name ? `${set.cycle.name} · ` : ''}
							{formatSetType(set.setTypeId)}
							{set.dateRelease ? ` · ${formatMonthYear(set.dateRelease)}` : ''}
						</p>
					</div>
					<TargetToggle target={target} />
				</header>
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between text-sm">
					<span>
						<span className="font-semibold">
							{formatPercent(set.have, set.need)}
						</span>{' '}
						<span className="text-muted-foreground">
							({set.have} of {set.need} copies)
						</span>
					</span>
					<span className="text-muted-foreground">
						{missingCount === 0
							? 'Complete!'
							: `${missingCount} ${missingCount === 1 ? 'card' : 'cards'} missing`}
					</span>
				</div>
				<ProgressBar
					have={set.have}
					need={set.need}
					label={`${set.name} completion`}
					className="h-3"
				/>
			</div>

			<AddProductForm
				setId={set.id}
				setName={set.name}
				productSize={set.printings.reduce((sum, p) => sum + p.quantity, 0)}
			/>

			<div className="flex flex-wrap items-center justify-between gap-2">
				{/* the filter lives in the URL, so it survives a reload */}
				<Label className="self-start font-normal">
					<Switch checked={missingOnly} onCheckedChange={setMissingOnly} />
					Only show missing cards
				</Label>
				<ShortcutHint />
			</div>

			{printings.length === 0 ? (
				<p className="text-muted-foreground">
					Nothing missing from this set. Nice!
				</p>
			) : (
				<ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-4">
					{printings.map((printing) => {
						const { need, owned } = printing.progress
						const { card } = printing
						const label = `${card.title} (${set.name})`
						return (
							<li key={printing.id}>
								<CardArtTile
									imageUrl={printing.imageLarge ?? printing.imageSmall}
									alt={card.title}
									dimmed={owned === 0}
									badge={<CountBadge owned={owned} target={need} />}
									overlay={
										<>
											<header className="flex flex-col gap-1">
												<div className="flex items-start justify-between gap-2">
													<h2 className="leading-tight font-bold">
														{card.title}
													</h2>
													<CountBadge
														owned={owned}
														target={need}
														title={
															target === 'product'
																? `You own ${owned} of this printing; ${need} come in the product`
																: `You own ${owned} across all printings; deck limit ${need}`
														}
													/>
												</div>
												<p className="text-muted-foreground text-xs">
													<FactionDot factionId={card.faction.id} />{' '}
													{card.faction.name} · {card.type.name}
													{card.displaySubtypes
														? `: ${card.displaySubtypes}`
														: ''}
												</p>
												<p className="text-muted-foreground text-xs">
													#{printing.position}
													{printing.illustrator
														? ` · ${printing.illustrator}`
														: ''}
												</p>
											</header>
											<OverlayCounters
												printing={printing}
												label={label}
												primary
											/>
											<VersionsButton
												title={card.title}
												printings={[{ printing, label, heading: set.name }]}
											/>
										</>
									}
								/>
							</li>
						)
					})}
				</ul>
			)}
		</main>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => <p>That set doesn't exist.</p>,
			}}
		/>
	)
}
