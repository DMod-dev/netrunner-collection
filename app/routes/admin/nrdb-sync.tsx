import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect } from 'react'
import { useFetcher, useRevalidator } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import { cn } from '#app/utils/misc.tsx'
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

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithRole(request, 'admin')
	const running = await isSyncRunning()
	const [history, lastSuccess, cards, printings, sets] = await Promise.all([
		prisma.nrdbSync.findMany({
			orderBy: { startedAt: 'desc' },
			take: 20,
		}),
		getLastSuccessfulSync(),
		prisma.card.count(),
		prisma.printing.count(),
		prisma.cardSet.count(),
	])
	return {
		running,
		autoSync: isAutoSyncEnabled(),
		nextDue: lastSuccess
			? new Date(lastSuccess.startedAt.getTime() + SYNC_EVERY_MS)
			: null,
		counts: { cards, printings, sets },
		history: history.map((sync) => ({
			...sync,
			summary: sync.summary
				? (JSON.parse(sync.summary) as NrdbSyncSummary)
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

const TRIGGER_LABELS: Record<string, string> = {
	schedule: 'Scheduled',
	manual: 'Manual',
	cli: 'Command line',
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short',
})

export default function NrdbSyncRoute({ loaderData }: Route.ComponentProps) {
	const { running, autoSync, nextDue, counts, history } = loaderData
	const fetcher = useFetcher<typeof action>()
	const revalidator = useRevalidator()
	const isStarting = fetcher.state !== 'idle'

	// while a sync runs, poll so the history updates when it finishes
	useEffect(() => {
		if (!running) return
		const interval = setInterval(() => {
			if (revalidator.state === 'idle') void revalidator.revalidate()
		}, 3000)
		return () => clearInterval(interval)
	}, [running, revalidator])

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-h2">Card data sync</h1>
				<p className="text-muted-foreground">
					Cards, printings and sets are copied from NetrunnerDB.{' '}
					{autoSync
						? `They re-sync automatically once a day${nextDue ? `; next after ${dateFormat.format(new Date(nextDue))}` : ' (the first sync starts shortly after the server starts)'}.`
						: 'Automatic syncing is off here (mocks, tests, or NRDB_AUTO_SYNC=false), so sync by hand.'}
				</p>
			</header>

			<dl className="grid grid-cols-3 gap-3 sm:max-w-md">
				{Object.entries(counts).map(([label, value]) => (
					<div key={label} className="bg-muted rounded-lg p-3">
						<dt className="text-muted-foreground text-xs capitalize">
							{label}
						</dt>
						<dd className="text-xl font-bold tabular-nums">
							{value.toLocaleString()}
						</dd>
					</div>
				))}
			</dl>

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

			<section aria-labelledby="history" className="flex flex-col gap-2">
				<h2 id="history" className="text-lg font-bold">
					Recent syncs
				</h2>
				{history.length === 0 ? (
					<p className="text-muted-foreground">No syncs yet.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="text-muted-foreground border-b text-xs">
								<tr>
									<th className="py-2 pr-4 font-medium">Started</th>
									<th className="py-2 pr-4 font-medium">Trigger</th>
									<th className="py-2 pr-4 font-medium">Status</th>
									<th className="py-2 font-medium">Details</th>
								</tr>
							</thead>
							<tbody className="divide-border divide-y">
								{history.map((sync) => (
									<tr key={sync.id}>
										<td className="py-2 pr-4 whitespace-nowrap">
											{dateFormat.format(new Date(sync.startedAt))}
										</td>
										<td className="py-2 pr-4">
											{TRIGGER_LABELS[sync.trigger] ?? sync.trigger}
										</td>
										<td className="py-2 pr-4">
											<span
												className={cn(
													'rounded-full px-2 py-0.5 text-xs font-semibold',
													sync.status === 'success' &&
														'bg-green-600/15 text-green-800 dark:text-green-300',
													sync.status === 'error' &&
														'bg-destructive/15 text-destructive',
													sync.status === 'running' &&
														'bg-secondary text-secondary-foreground',
												)}
											>
												{sync.status}
											</span>
										</td>
										<td className="text-muted-foreground max-w-md py-2">
											{sync.summary ? (
												`${sync.summary.cards} cards, ${sync.summary.printings} printings, ${sync.summary.sets} sets in ${(sync.summary.durationMs / 1000).toFixed(1)}s`
											) : sync.error ? (
												<details>
													<summary className="line-clamp-2 cursor-pointer">
														{sync.error.trim().split('\n').at(-1)}
													</summary>
													<pre className="mt-1 max-h-60 overflow-auto text-xs whitespace-pre-wrap">
														{sync.error}
													</pre>
												</details>
											) : null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	)
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
