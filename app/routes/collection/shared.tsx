import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { CollectionNav } from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	REMOVE_SHARE_INTENT,
	RemoveShareButton,
} from '#app/components/remove-share-button.tsx'
import { UserIcon } from '#app/components/user-icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	listSharesReceived,
	removeShareAction,
} from '#app/utils/collection-share.server.ts'
import { type Route } from './+types/shared.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	return { shares: await listSharesReceived(userId) }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	if (formData.get('intent') !== REMOVE_SHARE_INTENT) {
		throw new Response('Invalid intent', { status: 400 })
	}
	return removeShareAction(userId, formData)
}

export const meta: Route.MetaFunction = () => [
	{ title: 'Shared with me | Netrunner Collection' },
]

export default function SharedWithMeRoute({
	loaderData,
}: Route.ComponentProps) {
	const { shares } = loaderData
	return (
		<main className="container mb-24 flex flex-col gap-6">
			<CollectionNav />
			<div className="flex flex-col gap-1">
				<h1 className="text-h2">Shared with me</h1>
				<p className="text-muted-foreground max-w-prose">
					Collections other users have shared with you. You can browse them but
					not change them.
				</p>
			</div>

			{shares.length ? (
				<ul className="flex flex-col gap-3">
					{shares.map((share) => {
						const name = share.owner.name ?? share.owner.username
						return (
							<li
								key={share.id}
								className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
							>
								<Link
									to={`/users/${share.owner.username}/collection`}
									prefetch="intent"
									className="group flex min-w-0 items-center gap-3"
								>
									<UserIcon className="bg-muted size-10" />
									<span className="flex min-w-0 flex-col">
										<span className="truncate font-semibold group-hover:underline">
											{name}’s collection
										</span>
										<span className="text-muted-foreground truncate text-sm tabular-nums">
											{plural(share.totals.ownedCards, 'card')} ·{' '}
											{plural(share.totals.copies, 'copy', 'copies')}
										</span>
									</span>
								</Link>
								<RemoveShareButton
									shareId={share.id}
									label="Remove"
									accessibleName={`Remove ${name}’s collection`}
								/>
							</li>
						)
					})}
				</ul>
			) : (
				<div className="bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
					<h2 className="font-semibold">Nothing shared with you yet</h2>
					<p className="text-muted-foreground max-w-prose text-sm">
						When someone shares their collection with you, it shows up here. To
						share yours, go to{' '}
						<Link to="/settings/profile/sharing" className="underline">
							Sharing
						</Link>{' '}
						in settings.
					</p>
				</div>
			)}
		</main>
	)
}

function plural(count: number, one: string, many = `${one}s`) {
	return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
