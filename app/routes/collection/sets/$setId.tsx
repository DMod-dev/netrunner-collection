import { invariantResponse } from '@epic-web/invariant'
import { Link, useSearchParams } from 'react-router'
import {
	CollectionNav,
	formatPercent,
	formatSetType,
	ProgressBar,
	TargetToggle,
} from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot, PrintingTile } from '#app/components/printing-tile.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getSetCompletion,
	parseCompletionTarget,
} from '#app/utils/collection.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/$setId.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const target = parseCompletionTarget(
		new URL(request.url).searchParams.get('target'),
	)
	const set = await getSetCompletion(userId, params.setId, target)
	invariantResponse(set, 'Set not found', { status: 404 })
	return { target, set }
}

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: `${data?.set.name ?? 'Set'} | Netrunner Collection`,
	},
]

export default function SetRoute({ loaderData }: Route.ComponentProps) {
	const { target, set } = loaderData
	const [searchParams] = useSearchParams()
	const missingOnly = searchParams.get('show') === 'missing'
	const printings = missingOnly
		? set.printings.filter((p) => p.progress.have < p.progress.need)
		: set.printings
	const missingCount = set.printings.filter(
		(p) => p.progress.have < p.progress.need,
	).length

	const showParams = new URLSearchParams(searchParams)
	if (missingOnly) showParams.delete('show')
	else showParams.set('show', 'missing')
	const showQuery = showParams.toString()

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<CollectionNav />
			<div className="flex flex-col gap-1">
				<Link
					to={target === 'product' ? '..' : `..?target=${target}`}
					relative="path"
					className="text-muted-foreground hover:text-foreground self-start text-sm"
				>
					<Icon name="arrow-left">All sets</Icon>
				</Link>
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="text-h2">{set.name}</h1>
						<p className="text-muted-foreground text-sm">
							{set.cycle.name !== set.name ? `${set.cycle.name} · ` : ''}
							{formatSetType(set.setTypeId)}
							{set.dateRelease
								? ` · ${new Date(set.dateRelease).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}`
								: ''}
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

			<div className="flex items-center gap-2 self-start text-sm">
				{/* a link, not a checkbox, so the filter lives in the URL */}
				<Link
					to={{ search: showQuery ? `?${showQuery}` : '' }}
					replace
					preventScrollReset
					role="switch"
					aria-checked={missingOnly}
					className={cn(
						'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
						missingOnly ? 'bg-primary' : 'bg-muted-foreground/40',
					)}
				>
					<span
						className={cn(
							'bg-background absolute top-0.5 size-4 rounded-full shadow transition-[left]',
							missingOnly ? 'left-[1.125rem]' : 'left-0.5',
						)}
					/>
					<span className="sr-only">Only show missing cards</span>
				</Link>
				<span aria-hidden>Only show missing cards</span>
			</div>

			{printings.length === 0 ? (
				<p className="text-muted-foreground">
					Nothing missing from this set. Nice!
				</p>
			) : (
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
					{printings.map((printing) => {
						const { have, need, owned } = printing.progress
						const complete = have >= need
						return (
							<li key={printing.id}>
								<PrintingTile
									printing={printing}
									label={`${printing.card.title} (${set.name})`}
									heading={
										<>
											<FactionDot factionId={printing.card.faction.id} />{' '}
											{printing.card.title}
										</>
									}
									badge={
										<span
											className={cn(
												'mt-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
												complete
													? 'bg-green-600 text-white dark:bg-green-500'
													: owned > 0
														? 'bg-secondary text-secondary-foreground'
														: 'bg-muted text-muted-foreground',
											)}
											title={
												target === 'product'
													? `You own ${owned} of this printing; ${need} come in the product`
													: `You own ${owned} across all printings; deck limit ${need}`
											}
										>
											{owned} / {need}
										</span>
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
