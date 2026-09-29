import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useFetcher } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	SyncCounts,
	SyncHistory,
	syncDateFormat,
	useSyncPolling,
} from '#app/components/sync-history.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { DECK_FORMAT_NAMES, DECK_FORMATS } from '#app/utils/deck-formats.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import {
	getLastSuccessfulSync,
	isAutoSyncEnabled,
	isSyncRunning,
	type NrdbSyncSummary,
	startSyncInBackground,
	SYNC_EVERY_MS,
} from '#app/utils/nrdb.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { type Route } from './+types/nrdb-sync.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

// syncs from before formats and restrictions were synced didn't count them
type StoredSyncSummary = Omit<NrdbSyncSummary, 'formats' | 'restrictions'> &
	Partial<Pick<NrdbSyncSummary, 'formats' | 'restrictions'>>

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithRole(request, 'admin')
	const running = await isSyncRunning()
	const [
		history,
		lastSuccess,
		cards,
		printings,
		sets,
		formats,
		restrictions,
		deckFormats,
	] = await Promise.all([
		prisma.nrdbSync.findMany({
			orderBy: { startedAt: 'desc' },
			take: 20,
		}),
		getLastSuccessfulSync(),
		prisma.card.count(),
		prisma.printing.count(),
		prisma.cardSet.count(),
		prisma.format.count(),
		prisma.restriction.count(),
		prisma.format.findMany({
			where: { id: { in: [...DECK_FORMATS] } },
			select: { id: true, activeRestrictionId: true },
		}),
	])
	const activeRestrictions = await prisma.restriction.findMany({
		where: {
			id: {
				in: deckFormats.flatMap((f) =>
					f.activeRestrictionId ? [f.activeRestrictionId] : [],
				),
			},
		},
		select: { id: true, name: true, _count: { select: { verdicts: true } } },
	})
	return {
		running,
		autoSync: isAutoSyncEnabled(),
		nextDue: lastSuccess
			? new Date(lastSuccess.startedAt.getTime() + SYNC_EVERY_MS)
			: null,
		counts: { cards, printings, sets, formats, restrictions },
		// the lists in force for the formats players can pick
		formatLists: DECK_FORMATS.map((id) => {
			const restrictionId = deckFormats.find(
				(f) => f.id === id,
			)?.activeRestrictionId
			const restriction = activeRestrictions.find((r) => r.id === restrictionId)
			return {
				id,
				name: DECK_FORMAT_NAMES[id],
				restriction: restriction
					? { name: restriction.name, verdicts: restriction._count.verdicts }
					: null,
			}
		}),
		history: history.map(({ summary, ...sync }) => ({
			...sync,
			details: summary
				? describeSummary(JSON.parse(summary) as StoredSyncSummary)
				: null,
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	await requireUserWithRole(request, 'admin')
	// only the LiteFS primary can write; this replays the request there
	await ensurePrimary()
	const started = await startSyncInBackground('manual')
	return { started }
}

export const meta: Route.MetaFunction = () => [
	{ title: 'Card data sync | Netrunner Collection' },
]

export default function NrdbSyncRoute({ loaderData }: Route.ComponentProps) {
	const { running, autoSync, nextDue, counts, formatLists, history } =
		loaderData
	const fetcher = useFetcher<typeof action>()
	const isStarting = fetcher.state !== 'idle'
	// while a sync runs, poll so the history updates when it finishes
	useSyncPolling(running)

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-h1">Card data sync</h1>
				<p className="text-muted-foreground">
					Cards, printings and sets are copied from NetrunnerDB.{' '}
					{autoSync
						? `They re-sync automatically once a day${nextDue ? `; next after ${syncDateFormat.format(new Date(nextDue))}` : ' (the first sync starts shortly after the server starts)'}.`
						: 'Automatic syncing is off here (mocks, tests, or NRDB_AUTO_SYNC=false), so sync by hand.'}
				</p>
			</header>

			<SyncCounts counts={counts} />

			<section aria-labelledby="format-lists" className="flex flex-col gap-2">
				<h2 id="format-lists" className="text-lg font-bold">
					Ban and points lists
				</h2>
				<ul className="flex flex-col gap-1 text-sm">
					{formatLists.map((format) => (
						<li key={format.id}>
							<span className="font-semibold">{format.name}:</span>{' '}
							{format.restriction ? (
								<>
									{format.restriction.name}{' '}
									<span className="text-muted-foreground">
										({format.restriction.verdicts.toLocaleString()}{' '}
										{format.restriction.verdicts === 1 ? 'card' : 'cards'})
									</span>
								</>
							) : (
								<span className="text-muted-foreground">
									none (sync to fetch)
								</span>
							)}
						</li>
					))}
				</ul>
			</section>

			<div className="flex flex-wrap items-center gap-3">
				<fetcher.Form method="POST">
					<StatusButton
						type="submit"
						status={running || isStarting ? 'pending' : 'idle'}
						disabled={running || isStarting}
					>
						{running ? 'Syncing…' : 'Sync now'}
					</StatusButton>
				</fetcher.Form>
				{fetcher.data && !fetcher.data.started ? (
					<p className="text-muted-foreground text-sm">
						A sync is already running.
					</p>
				) : null}
			</div>

			<SyncHistory history={history} />
		</main>
	)
}

function describeSummary(summary: StoredSyncSummary) {
	const parts = [
		`${summary.cards} cards`,
		`${summary.printings} printings`,
		`${summary.sets} sets`,
	]
	if (summary.restrictions !== undefined) {
		parts.push(`${summary.restrictions} ban/points lists`)
	}
	return `${parts.join(', ')} in ${(summary.durationMs / 1000).toFixed(1)}s`
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				403: () => <p>Only admins can manage the card data sync.</p>,
			}}
		/>
	)
}
