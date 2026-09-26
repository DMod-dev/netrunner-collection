import { LogOut01 } from '@untitledui/icons'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	type LoaderFunctionArgs,
	Form,
	Link,
	useLoaderData,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { Button, buttonVariants } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { UserIcon } from '#app/components/user-icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { formatDate } from '#app/utils/dates.ts'
import { prisma } from '#app/utils/db.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	await requireUserId(request)
	const user = await prisma.user.findFirst({
		select: {
			id: true,
			name: true,
			username: true,
			createdAt: true,
		},
		where: {
			username: params.username,
		},
	})

	invariantResponse(user, 'User not found', { status: 404 })

	return { user, userJoinedDisplay: formatDate(user.createdAt) }
}

export default function ProfileRoute() {
	const data = useLoaderData<typeof loader>()
	const user = data.user
	const userDisplayName = user.name ?? user.username
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = user.id === loggedInUser?.id

	return (
		<div className="container mt-36 mb-48 flex flex-col items-center justify-center">
			<Spacer size="4xs" />

			<div className="bg-muted container flex flex-col items-center rounded-3xl p-12">
				<div className="relative w-52">
					<div className="absolute -top-40">
						<div className="relative">
							<UserIcon className="size-52" />
						</div>
					</div>
				</div>

				<Spacer size="sm" />

				<div className="flex flex-col items-center">
					<div className="flex flex-wrap items-center justify-center gap-4">
						<h1 className="text-h2 text-center">{userDisplayName}</h1>
					</div>
					<p className="text-muted-foreground mt-2 text-center">
						Joined {data.userJoinedDisplay}
					</p>
					{isLoggedInUser ? (
						<Form action="/logout" method="POST" className="mt-3">
							<Button type="submit" variant="link" className="px-12">
								<Icon icon={LogOut01} className="scale-125 max-md:scale-150">
									Logout
								</Icon>
							</Button>
						</Form>
					) : null}
					{isLoggedInUser ? (
						<div className="mt-10 flex gap-4">
							<Link
								to="/collection"
								prefetch="intent"
								className={buttonVariants()}
							>
								My collection
							</Link>
							<Link
								to="/settings/profile"
								prefetch="intent"
								className={buttonVariants()}
							>
								Edit profile
							</Link>
						</div>
					) : null}
				</div>
			</div>
		</div>
	)
}

export const meta: Route.MetaFunction = ({ loaderData, params }) => {
	const displayName = loaderData?.user.name ?? params.username
	return [
		{ title: `${displayName} | Netrunner Collection` },
		{
			name: 'description',
			content: `Profile of ${displayName} on Netrunner Collection`,
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No user with the username "{params.username}" exists</p>
				),
			}}
		/>
	)
}
