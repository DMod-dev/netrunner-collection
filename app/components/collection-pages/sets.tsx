import { RefreshCw01 } from '@untitledui/icons'
import { Link } from 'react-router'
import { CollectionAccessProvider } from '#app/components/collection-access-context.tsx'
import {
	CollectionNav,
	formatPercent,
	formatSetType,
	ProgressBar,
	TargetToggle,
} from '#app/components/collection-ui.tsx'
import { buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	NativeSelect,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import { type SetsPageData } from '#app/utils/collection-loaders.server.ts'
import { getYear } from '#app/utils/dates.ts'
import { cn } from '#app/utils/misc.tsx'
import { userHasRole, useUser } from '#app/utils/user.ts'

/** The Sets page, for your own collection or one shared with you. */
export function SetsPage({ loaderData }: { loaderData: SetsPageData }) {
	const { target, cycles, access } = loaderData
	const setQuery = target === 'product' ? '' : `?target=${target}`
	const sets = cycles.flatMap((c) => c.sets)
	const have = sets.reduce((sum, set) => sum + set.have, 0)
	const need = sets.reduce((sum, set) => sum + set.need, 0)
	const completeSets = sets.filter(
		(set) => set.need > 0 && set.have >= set.need,
	).length

	return (
		<CollectionAccessProvider value={access}>
			<main className="container mb-24 flex flex-col gap-6">
				<CollectionNav />
				<header className="flex flex-wrap items-end justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h1 className="text-h2">Set completion</h1>
						{sets.length ? (
							<p className="text-muted-foreground text-sm">
								<span className="text-foreground font-semibold">
									{formatPercent(have, need)}
								</span>{' '}
								of every set ({have.toLocaleString('en-US')} of{' '}
								{need.toLocaleString('en-US')} copies) · {completeSets} of{' '}
								{sets.length} sets complete
							</p>
						) : null}
					</div>
					<TargetToggle target={target} />
				</header>

				{cycles.length === 0 ? <NoSets /> : <JumpToCycle cycles={cycles} />}

				<div className="flex flex-col gap-8">
					{cycles.map((cycle) => {
						// a cycle that's just one set of the same name (e.g. System
						// Gateway) doesn't need its own heading
						const standalone =
							cycle.sets.length === 1 && cycle.sets[0]!.name === cycle.name
						return (
							<section
								key={cycle.id}
								id={`cycle-${cycle.id}-sets`}
								aria-labelledby={`cycle-${cycle.id}`}
								className="flex scroll-mt-4 flex-col gap-2"
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
								<ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
									{cycle.sets.map((set) => (
										<li key={set.id}>
											<Link
												to={`${access.basePath}/sets/${set.id}${setQuery}`}
												prefetch="intent"
												className="hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-ring grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset sm:grid-cols-[minmax(12rem,1fr)_2fr_auto]"
											>
												<span className="flex flex-col">
													<span className="font-semibold">{set.name}</span>
													<span className="text-muted-foreground text-xs">
														{formatSetType(set.setTypeId)}
														{set.dateRelease
															? ` · ${getYear(set.dateRelease)}`
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
		</CollectionAccessProvider>
	)
}

function NoSets() {
	const user = useUser()
	return (
		<div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
			<p className="font-semibold">No card data yet</p>
			<p className="text-muted-foreground max-w-md text-sm">
				Sets show up here once card data has been loaded from NetrunnerDB.
			</p>
			{userHasRole(user, 'admin') ? (
				<Link to="/admin/nrdb-sync" className={buttonVariants()}>
					<Icon icon={RefreshCw01}>Sync card data</Icon>
				</Link>
			) : (
				<p className="text-muted-foreground max-w-md text-sm">
					Check back soon.
				</p>
			)}
		</div>
	)
}

/** The list covers every cycle since 2012, so offer a shortcut down it. */
function JumpToCycle({ cycles }: { cycles: SetsPageData['cycles'] }) {
	return (
		<NativeSelect
			aria-label="Jump to cycle"
			value=""
			onChange={(e) => {
				document
					.getElementById(`cycle-${e.currentTarget.value}-sets`)
					?.scrollIntoView()
			}}
			className="self-start"
		>
			<NativeSelectOption value="" disabled>
				Jump to cycle…
			</NativeSelectOption>
			{cycles.map((cycle) => (
				<NativeSelectOption key={cycle.id} value={cycle.id}>
					{cycle.name}
				</NativeSelectOption>
			))}
		</NativeSelect>
	)
}
