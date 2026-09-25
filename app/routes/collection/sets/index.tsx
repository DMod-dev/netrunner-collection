import { Link } from 'react-router'
import {
	CollectionNav,
	formatPercent,
	formatSetType,
	ProgressBar,
	TargetToggle,
} from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getSetsProgress,
	parseCompletionTarget,
} from '#app/utils/collection.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const target = parseCompletionTarget(
		new URL(request.url).searchParams.get('target'),
	)
	const cycles = await getSetsProgress(userId, target)
	return { target, cycles }
}

export const meta: Route.MetaFunction = () => [
	{ title: 'Set completion | Netrunner Collection' },
]

export default function SetsRoute({ loaderData }: Route.ComponentProps) {
	const { target, cycles } = loaderData
	const setQuery = target === 'product' ? '' : `?target=${target}`

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<CollectionNav />
			<header className="flex flex-wrap items-end justify-between gap-4">
				<h1 className="text-h2">Set completion</h1>
				<TargetToggle target={target} />
			</header>

			<div className="flex flex-col gap-8">
				{cycles.map((cycle) => {
					// a cycle that's just one set of the same name (e.g. System
					// Gateway) doesn't need its own heading
					const standalone =
						cycle.sets.length === 1 && cycle.sets[0]!.name === cycle.name
					return (
						<section
							key={cycle.id}
							aria-labelledby={`cycle-${cycle.id}`}
							className="flex flex-col gap-2"
						>
							<header
								className={cn(
									'flex items-baseline justify-between gap-4',
									standalone && 'sr-only',
								)}
							>
								<h2 id={`cycle-${cycle.id}`} className="text-lg font-bold">
									{cycle.name}
								</h2>
								<span className="text-muted-foreground text-sm tabular-nums">
									{formatPercent(cycle.have, cycle.need)}
								</span>
							</header>
							<ul className="border-border divide-border divide-y rounded-lg border">
								{cycle.sets.map((set) => (
									<li key={set.id}>
										<Link
											to={`${set.id}${setQuery}`}
											prefetch="intent"
											className="hover:bg-muted/50 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_2fr_auto]"
										>
											<span className="flex flex-col">
												<span className="font-semibold">{set.name}</span>
												<span className="text-muted-foreground text-xs">
													{formatSetType(set.setTypeId)}
													{set.dateRelease
														? ` · ${new Date(set.dateRelease).getFullYear()}`
														: ''}{' '}
													· {set.completeCards}/{set.cardCount} cards complete
												</span>
											</span>
											<ProgressBar
												have={set.have}
												need={set.need}
												label={`${set.name} completion`}
												className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
											/>
											<span className="text-right text-sm tabular-nums sm:col-start-3 sm:row-start-1">
												<span className="font-semibold">
													{formatPercent(set.have, set.need)}
												</span>
												<span className="text-muted-foreground block text-xs">
													{set.have}/{set.need}
												</span>
											</span>
										</Link>
									</li>
								))}
							</ul>
						</section>
					)
				})}
			</div>
		</main>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
