import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useId, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { CollectionNav } from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	applyImport,
	type ImportMode,
	ImportFormatError,
	parseImport,
	summarizeImport,
} from '#app/utils/collection-io.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/import-export.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const MAX_IMPORT_BYTES = 2_000_000

async function getTotals(userId: string) {
	const [entries, variants] = await Promise.all([
		prisma.collectionEntry.aggregate({
			where: { userId },
			_sum: { quantity: true },
			_count: true,
		}),
		prisma.variant.aggregate({
			where: { userId },
			_sum: { quantity: true },
			_count: true,
		}),
	])
	return {
		copies: (entries._sum.quantity ?? 0) + (variants._sum.quantity ?? 0),
		rows: entries._count + variants._count,
	}
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	return { totals: await getTotals(userId) }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')
	const content = String(formData.get('content') ?? '')
	const mode: ImportMode =
		formData.get('mode') === 'replace' ? 'replace' : 'add'

	if (!content.trim()) {
		return data(
			{ ok: false as const, error: 'Choose a file or paste some data first.' },
			{ status: 400 },
		)
	}
	if (content.length > MAX_IMPORT_BYTES) {
		return data(
			{ ok: false as const, error: 'That file is too large (2 MB max).' },
			{ status: 400 },
		)
	}

	let parsed
	try {
		parsed = await parseImport(content)
	} catch (error) {
		if (error instanceof ImportFormatError) {
			return data({ ok: false as const, error: error.message }, { status: 400 })
		}
		throw error
	}
	const summary = summarizeImport(parsed)

	if (intent === 'apply') {
		if (summary.copies === 0 && mode === 'add') {
			return data(
				{ ok: false as const, error: 'Nothing in that file to import.' },
				{ status: 400 },
			)
		}
		await applyImport(userId, parsed, mode)
		return { ok: true as const, applied: true as const, mode, summary }
	}
	return { ok: true as const, applied: false as const, mode, summary }
}

export const meta: Route.MetaFunction = () => [
	{ title: 'Import & export | Netrunner Collection' },
]

export default function ImportExportRoute({
	loaderData,
}: Route.ComponentProps) {
	const { totals } = loaderData
	return (
		<main className="container mb-24 flex flex-col gap-8">
			<CollectionNav />
			<h1 className="text-h2">Import & export</h1>

			<section aria-labelledby="export" className="flex flex-col gap-3">
				<h2 id="export" className="text-lg font-bold">
					Export
				</h2>
				<p className="text-muted-foreground">
					Download your collection ({totals.copies.toLocaleString()} copies) as
					a backup, or to edit in a spreadsheet and import again.
				</p>
				<div className="flex flex-wrap gap-2">
					<Button asChild>
						<a href="/resources/collection-export?format=csv" download>
							<Icon name="download">Download CSV</Icon>
						</a>
					</Button>
					<Button asChild variant="outline">
						<a href="/resources/collection-export?format=json" download>
							<Icon name="download">Download JSON</Icon>
						</a>
					</Button>
				</div>
			</section>

			<ImportSection currentCopies={totals.copies} />
		</main>
	)
}

function ImportSection({ currentCopies }: { currentCopies: number }) {
	const id = useId()
	const fetcher = useFetcher<typeof action>()
	const [content, setContent] = useState('')
	const [mode, setMode] = useState<ImportMode>('add')
	// the content + mode the current preview describes; editing either
	// invalidates it so we never apply something the user hasn't previewed
	const [previewed, setPreviewed] = useState<string | null>(null)
	const isPending = fetcher.state !== 'idle'
	const result = fetcher.data
	const previewKey = `${mode}\n${content}`
	const preview =
		result?.ok && !result.applied && previewed === previewKey
			? result.summary
			: null

	useEffect(() => {
		if (fetcher.state !== 'idle' || !fetcher.data?.ok) return
		if (fetcher.data.applied) {
			const { summary, mode } = fetcher.data
			toast.success(
				mode === 'replace'
					? `Collection replaced: ${summary.copies} copies`
					: `Imported ${summary.copies} copies`,
			)
			setContent('')
			setPreviewed(null)
		}
	}, [fetcher.state, fetcher.data])

	function submit(intent: 'preview' | 'apply') {
		if (intent === 'preview') setPreviewed(previewKey)
		void fetcher.submit({ intent, content, mode }, { method: 'POST' })
	}

	return (
		<section aria-labelledby="import" className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 id="import" className="text-lg font-bold">
					Import
				</h2>
				<p className="text-muted-foreground">
					Import a file exported from here, or your own CSV. It needs a header
					row with a <code>quantity</code> column and either{' '}
					<code>printing_id</code> (the NetrunnerDB code, e.g. 30075) or{' '}
					<code>card</code> + <code>set</code> names. Leave out the set to use
					the newest printing. An optional <code>version</code> column records
					alt arts and other versions.
				</p>
				<pre className="bg-muted mt-1 overflow-x-auto rounded-md p-3 text-xs">
					{`card,set,quantity,version
Hedge Fund,System Gateway,3,
Hedge Fund,System Gateway,1,Worlds 2023 alt art
Sure Gamble,,3,`}
				</pre>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor={`${id}-file`}>File</Label>
				<input
					id={`${id}-file`}
					type="file"
					accept=".csv,.json,text/csv,application/json"
					className="file:bg-secondary text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
					onChange={async (e) => {
						const file = e.currentTarget.files?.[0]
						e.currentTarget.value = ''
						if (!file) return
						if (file.size > MAX_IMPORT_BYTES) {
							toast.error('That file is too large (2 MB max).')
							return
						}
						setContent(await file.text())
					}}
				/>
				<Label htmlFor={`${id}-content`} className="mt-2">
					…or paste CSV / JSON
				</Label>
				<Textarea
					id={`${id}-content`}
					rows={6}
					value={content}
					onChange={(e) => setContent(e.currentTarget.value)}
					className="font-mono text-xs"
					spellCheck={false}
				/>
			</div>

			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">When importing</legend>
				<ModeOption
					checked={mode === 'add'}
					onChange={() => setMode('add')}
					title="Add to my collection"
					description="Counts in the file are added to what you already have."
				/>
				<ModeOption
					checked={mode === 'replace'}
					onChange={() => setMode('replace')}
					title="Replace my collection"
					description={`Your current collection (${currentCopies} copies) is removed and replaced by the file. Use this to restore a backup.`}
				/>
			</fieldset>

			<div className="flex flex-wrap items-center gap-2">
				<StatusButton
					type="button"
					variant={preview ? 'outline' : 'default'}
					status={isPending && !preview ? 'pending' : 'idle'}
					disabled={!content.trim() || isPending}
					onClick={() => submit('preview')}
				>
					Preview import
				</StatusButton>
			</div>

			{result && !result.ok ? (
				<p className="text-foreground-destructive text-sm" role="alert">
					{result.error}
				</p>
			) : null}

			{preview ? (
				<div
					className="border-border flex flex-col gap-3 rounded-lg border p-4"
					aria-live="polite"
				>
					<p>
						Read {preview.rowCount} {preview.rowCount === 1 ? 'row' : 'rows'} (
						{preview.format.toUpperCase()}):{' '}
						<strong>{preview.copies} copies</strong> across {preview.printings}{' '}
						printings
						{preview.versions ? ` and ${preview.versions} custom versions` : ''}
						.
					</p>
					{preview.errorCount ? (
						<div className="text-sm">
							<p className="font-semibold text-amber-700 dark:text-amber-300">
								{preview.errorCount} {preview.errorCount === 1 ? 'row' : 'rows'}{' '}
								will be skipped:
							</p>
							<ul className="text-muted-foreground max-h-40 list-inside list-disc overflow-y-auto">
								{preview.errors.map((e) => (
									<li key={e.line}>
										Line {e.line}: {e.message}
									</li>
								))}
								{preview.errorCount > preview.errors.length ? (
									<li>
										…and {preview.errorCount - preview.errors.length} more
									</li>
								) : null}
							</ul>
						</div>
					) : null}
					<StatusButton
						type="button"
						className="self-start"
						variant={mode === 'replace' ? 'destructive' : 'default'}
						status={isPending ? 'pending' : 'idle'}
						disabled={isPending || (mode === 'add' && preview.copies === 0)}
						onClick={() => submit('apply')}
					>
						{mode === 'replace'
							? `Replace my ${currentCopies} copies with these ${preview.copies}`
							: `Add ${preview.copies} copies to my collection`}
					</StatusButton>
				</div>
			) : null}

			{result?.ok && result.applied ? (
				<p className="text-sm">
					Done!{' '}
					<Link to="/collection" className="underline">
						View your collection
					</Link>
				</p>
			) : null}
		</section>
	)
}

function ModeOption({
	checked,
	onChange,
	title,
	description,
}: {
	checked: boolean
	onChange: () => void
	title: string
	description: string
}) {
	return (
		<label
			className={cn(
				'flex cursor-pointer items-start gap-3 rounded-md border p-3',
				checked ? 'border-primary' : 'border-border',
			)}
		>
			<input
				type="radio"
				name="import-mode"
				checked={checked}
				onChange={onChange}
				className="mt-1"
			/>
			<span className="flex flex-col">
				<span className="font-medium">{title}</span>
				<span className="text-muted-foreground text-sm">{description}</span>
			</span>
		</label>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
