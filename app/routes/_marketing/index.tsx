import { Link, redirect } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/index.ts'

export const meta: Route.MetaFunction = () => [
	{ title: 'Netrunner Collection' },
	{
		name: 'description',
		content:
			'Track which Android: Netrunner and Null Signal Games cards you own, down to the printing and alt art.',
	},
]

export async function loader({ request }: Route.LoaderArgs) {
	if (await getUserId(request)) throw redirect('/collection')
	return null
}

export default function Index() {
	return (
		<main className="container grid h-full place-items-center py-24">
			<div className="flex max-w-xl flex-col items-center gap-6 text-center">
				<h1 className="text-h1">Know what's in your binder</h1>
				<p className="text-muted-foreground text-lg">
					Search every Netrunner card from Core Set to the latest Null Signal
					release, record how many you own of each printing, and keep track of
					your alt arts and promos too.
				</p>
				<div className="flex gap-4">
					<Button asChild size="lg">
						<Link to="/signup">Sign up</Link>
					</Button>
					<Button asChild size="lg" variant="outline">
						<Link to="/login">Log in</Link>
					</Button>
				</div>
				<p className="text-muted-foreground text-sm">
					Card data from{' '}
					<a
						href="https://netrunnerdb.com"
						className="underline"
						target="_blank"
						rel="noreferrer"
					>
						NetrunnerDB
					</a>
					.
				</p>
			</div>
		</main>
	)
}
