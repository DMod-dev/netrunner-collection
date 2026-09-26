import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { SearchMd } from '@untitledui/icons'
import {
	data,
	redirect,
	Form,
	Link,
	useFetcher,
	useSearchParams,
	useSubmit,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Field } from '#app/components/forms.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelect,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import {
	cache,
	getAllCacheKeys,
	lruCache,
	searchCacheKeys,
} from '#app/utils/cache.server.ts'
import {
	ensureInstance,
	getAllInstances,
	getInstanceInfo,
} from '#app/utils/litefs.server.ts'
import { pageTitle, useDebounce, useDoubleCheck } from '#app/utils/misc.tsx'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Cache') }]

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithRole(request, 'admin')
	const searchParams = new URL(request.url).searchParams
	const query = searchParams.get('query')
	if (query === '') {
		searchParams.delete('query')
		return redirect(`/admin/cache?${searchParams.toString()}`)
	}
	const limit = Number(searchParams.get('limit') ?? 100)

	const currentInstanceInfo = await getInstanceInfo()
	const instance =
		searchParams.get('instance') ?? currentInstanceInfo.currentInstance
	const instances = await getAllInstances()
	await ensureInstance(instance)

	let cacheKeys: { sqlite: Array<string>; lru: Array<string> }
	if (typeof query === 'string') {
		cacheKeys = await searchCacheKeys(query, limit)
	} else {
		cacheKeys = await getAllCacheKeys(limit)
	}
	return { cacheKeys, instance, instances, currentInstanceInfo }
}

export async function action({ request }: Route.ActionArgs) {
	await requireUserWithRole(request, 'admin')
	const formData = await request.formData()
	const key = formData.get('cacheKey')
	const { currentInstance } = await getInstanceInfo()
	const instance = formData.get('instance') ?? currentInstance
	const type = formData.get('type')

	invariantResponse(typeof key === 'string', 'cacheKey must be a string')
	invariantResponse(typeof type === 'string', 'type must be a string')
	invariantResponse(typeof instance === 'string', 'instance must be a string')
	await ensureInstance(instance)

	switch (type) {
		case 'sqlite': {
			await cache.delete(key)
			break
		}
		case 'lru': {
			lruCache.delete(key)
			break
		}
		default: {
			throw new Error(`Unknown cache type: ${type}`)
		}
	}
	// the row is gone after revalidation, so the confirmation has to come from
	// the root toast rather than this fetcher's data
	return data(
		{ success: true },
		{
			headers: await createToastHeaders({
				type: 'success',
				title: 'Cache entry deleted',
				description: key,
			}),
		},
	)
}

export default function CacheAdminRoute({ loaderData }: Route.ComponentProps) {
	const [searchParams] = useSearchParams()
	const submit = useSubmit()
	const query = searchParams.get('query') ?? ''
	const limit = searchParams.get('limit') ?? '100'
	const instance = searchParams.get('instance') ?? loaderData.instance

	const handleFormChange = useDebounce(async (form: HTMLFormElement) => {
		await submit(form)
	}, 400)

	return (
		<div className="container">
			<h1 className="text-h1">Cache Admin</h1>
			<Spacer size="2xs" />
			<Form
				method="get"
				className="flex flex-col gap-4"
				onChange={(e) => handleFormChange(e.currentTarget)}
			>
				<div className="flex-1">
					<div className="flex flex-1 gap-4">
						<Button
							type="submit"
							variant="ghost"
							size="icon"
							aria-label="Search"
							className="mt-3.5"
						>
							<Icon icon={SearchMd} size="sm" />
						</Button>
						<Field
							className="flex-1"
							labelProps={{ children: 'Search' }}
							inputProps={{
								type: 'search',
								name: 'query',
								defaultValue: query,
							}}
						/>
						<div className="text-muted-foreground flex h-16 w-14 items-center text-lg font-medium">
							<span title="Total results shown">
								{loaderData.cacheKeys.sqlite.length +
									loaderData.cacheKeys.lru.length}
							</span>
						</div>
					</div>
				</div>
				<div className="flex flex-wrap items-start gap-4">
					<Field
						labelProps={{
							children: 'Limit',
						}}
						inputProps={{
							name: 'limit',
							defaultValue: limit,
							type: 'number',
							step: '1',
							min: '1',
							max: '10000',
							placeholder: 'results limit',
						}}
					/>
					<div>
						<Label htmlFor="cache-instance">Instance</Label>
						<NativeSelect
							id="cache-instance"
							name="instance"
							defaultValue={instance}
						>
							{Object.entries(loaderData.instances).map(([inst, region]) => (
								<NativeSelectOption key={inst} value={inst}>
									{[
										inst,
										`(${region})`,
										inst === loaderData.currentInstanceInfo.currentInstance
											? '(current)'
											: '',
										inst === loaderData.currentInstanceInfo.primaryInstance
											? ' (primary)'
											: '',
									]
										.filter(Boolean)
										.join(' ')}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
				</div>
			</Form>
			<Spacer size="2xs" />
			<div className="flex flex-col gap-4">
				<h2 className="text-h2">LRU Cache:</h2>
				{loaderData.cacheKeys.lru.length ? (
					loaderData.cacheKeys.lru.map((key) => (
						<CacheKeyRow
							key={key}
							cacheKey={key}
							instance={instance}
							type="lru"
						/>
					))
				) : (
					<EmptyKeys query={query} />
				)}
			</div>
			<Spacer size="3xs" />
			<div className="flex flex-col gap-4">
				<h2 className="text-h2">SQLite Cache:</h2>
				{loaderData.cacheKeys.sqlite.length ? (
					loaderData.cacheKeys.sqlite.map((key) => (
						<CacheKeyRow
							key={key}
							cacheKey={key}
							instance={instance}
							type="sqlite"
						/>
					))
				) : (
					<EmptyKeys query={query} />
				)}
			</div>
		</div>
	)
}

function EmptyKeys({ query }: { query: string }) {
	return (
		<p className="text-muted-foreground">
			{query ? `No keys match "${query}".` : 'No keys cached.'}
		</p>
	)
}

function CacheKeyRow({
	cacheKey,
	instance,
	type,
}: {
	cacheKey: string
	instance?: string
	type: 'sqlite' | 'lru'
}) {
	const fetcher = useFetcher<typeof action>()
	const dc = useDoubleCheck()
	const encodedKey = encodeURIComponent(cacheKey)
	const valuePage = `/admin/cache/${type}/${encodedKey}?instance=${instance}`
	return (
		<div className="flex items-start gap-2 font-mono">
			<fetcher.Form method="POST">
				<input type="hidden" name="cacheKey" value={cacheKey} />
				<input type="hidden" name="instance" value={instance} />
				<input type="hidden" name="type" value={type} />
				<Button
					size="sm"
					variant="secondary"
					{...dc.getButtonProps({ type: 'submit' })}
				>
					{fetcher.state === 'idle'
						? dc.doubleCheck
							? 'You sure?'
							: 'Delete'
						: 'Deleting...'}
				</Button>
			</fetcher.Form>
			<Link reloadDocument to={valuePage} className="min-w-0 break-all">
				{cacheKey}
			</Link>
		</div>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				403: ({ error }) => (
					<p>You are not allowed to do that: {error?.data.message}</p>
				),
			}}
		/>
	)
}
