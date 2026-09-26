import { ArrowRight, File06 } from '@untitledui/icons'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, Outlet, useMatches } from 'react-router'
import { z } from 'zod'
import { Spacer } from '#app/components/spacer.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn, pageTitle } from '#app/utils/misc.tsx'
import { useUser } from '#app/utils/user.ts'
import { type Route } from './+types/_layout.tsx'

export const BreadcrumbHandle = z.object({ breadcrumb: z.any() })
export type BreadcrumbHandle = z.infer<typeof BreadcrumbHandle>

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon icon={File06}>Edit Profile</Icon>,
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Profile') }]

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { username: true },
	})
	invariantResponse(user, 'User not found', { status: 404 })
	return {}
}

const BreadcrumbHandleMatch = z.object({
	handle: BreadcrumbHandle,
})

export default function EditUserProfile() {
	const user = useUser()
	const matches = useMatches()
	const breadcrumbs = matches
		.map((m) => {
			const result = BreadcrumbHandleMatch.safeParse(m)
			if (!result.success || !result.data.handle.breadcrumb) return null
			return {
				id: m.id,
				pathname: m.pathname,
				breadcrumb: result.data.handle.breadcrumb,
			}
		})
		.filter((crumb) => crumb !== null)

	return (
		<div className="m-auto mt-16 mb-24 max-w-3xl">
			<nav aria-label="Breadcrumb" className="container">
				<ol className="flex flex-wrap gap-3">
					<li>
						<Link
							className="text-muted-foreground"
							to={`/users/${user.username}`}
						>
							Profile
						</Link>
					</li>
					{breadcrumbs.map((crumb, i, arr) => {
						const isCurrent = i === arr.length - 1
						return (
							<li
								key={crumb.id}
								className={cn('flex items-center gap-3', {
									'text-muted-foreground': !isCurrent,
								})}
							>
								<Icon icon={ArrowRight} size="sm">
									<Link
										to={crumb.pathname}
										className="flex items-center"
										aria-current={isCurrent ? 'page' : undefined}
									>
										{crumb.breadcrumb}
									</Link>
								</Icon>
							</li>
						)
					})}
				</ol>
			</nav>
			<Spacer size="xs" />
			<main className="bg-muted mx-auto px-6 py-8 md:container md:rounded-3xl">
				<Outlet />
			</main>
		</div>
	)
}
