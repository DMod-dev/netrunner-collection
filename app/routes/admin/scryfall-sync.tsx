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
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import {
	getLastSuccessfulMtgSync,
	isMtgAutoSyncEnabled,
	isMtgSyncRunning,
	MTG_SYNC_EVERY_MS,
	type ScryfallSyncSummary,
	startMtgSyncInBackground,
} from '#app/utils/scryfall.server.ts'
import { type Route } from './+types/scryfall-sync.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithRole(request, 'admin')
	const running = await isMtgSyncRunning()
	const [history, lastSuccess, cards, printings, sets] = await Promise.all([
		prisma.mtgSync.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
		getLastSuccessfulMtgSync(),
		prisma.mtgCard.count(),
		prisma.mtgPrinting.count(),
		prisma.mtgSet.count(),
	])
	return {
		running,
		autoSync: isMtgAutoSyncEnabled(),
		nextDue: lastSuccess
			? new Date(lastSuccess.startedAt.getTime() + MTG_SYNC_EVERY_MS)
			: null,
		fileUpdatedAt: lastSuccess?.bulkUpdatedAt ?? null,
		counts: { cards, printings, sets },
		history: history.map(({ summary, ...sync }) => ({
			...sync,
			details: summary
				? describeSummary(JSON.parse(summary) as ScryfallSyncSummary)
				: null,
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	await requireUserWithRole(request, 'admin')
	// only the LiteFS primary can write; this replays the request there
	await ensurePrimary()
	// an admin asking for a sync gets one, even if Scryfall's file is unchanged
	const started = await startMtgSyncInBackground('manual', { force: true })
	return { started }
}

export const meta: Route.MetaFunction = () => [
	{ title: 'MTG card data sync | Netrunner Collection' },
]

export default function ScryfallSyncRoute({
	loaderData,
}: Route.ComponentProps) {
	const { running, autoSync, nextDue, fileUpdatedAt, counts, history } =
		loaderData
	const fetcher = useFetcher<typeof action>()
	const isStarting = fetcher.state !== 'idle'
	// while a sync runs, poll so the history updates when it finishes
	useSyncPolling(running)

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-h1">MTG card data sync</h1>
				<p className="text-muted-foreground">
					Magic cards, printings, sets and prices are copied from
					Scryfall&apos;s daily bulk file
					{fileUpdatedAt
						? ` (the current copy is from ${syncDateFormat.format(new Date(fileUpdatedAt))})`
						: ''}
					.{' '}
					{autoSync
						? `Scryfall is checked for a new file every 12 hours${nextDue ? `; next after ${syncDateFormat.format(new Date(nextDue))}` : ' (the first check runs a few minutes after the server starts)'}.`
						: 'Automatic syncing is off here (mocks, tests, or MTG_AUTO_SYNC=false), so sync by hand.'}
				</p>
			</header>

			<SyncCounts counts={counts} />

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

export function describeSummary(summary: ScryfallSyncSummary) {
	const seconds = `${(summary.durationMs / 1000).toFixed(1)}s`
	if (summary.skipped) return `Scryfall's file hadn't changed (${seconds})`
	const parts = [
		`${summary.cards.toLocaleString()} cards`,
		`${summary.printings.toLocaleString()} printings`,
		`${summary.sets.toLocaleString()} sets`,
		`${summary.printingsWritten.toLocaleString()} printings changed`,
	]
	if (summary.printingsDeleted) {
		parts.push(`${summary.printingsDeleted.toLocaleString()} removed`)
	}
	if (summary.printingsKept) {
		parts.push(
			`${summary.printingsKept.toLocaleString()} gone but kept (in use)`,
		)
	}
	if (summary.deletionsSkipped) {
		parts.push('removals skipped (too many vanished at once)')
	}
	return `${parts.join(', ')} in ${seconds}`
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
