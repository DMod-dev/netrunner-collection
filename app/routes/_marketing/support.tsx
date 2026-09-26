import { Link } from 'react-router'
import { ExternalLink, MarketingPage } from '#app/components/marketing-page.tsx'
import { pageTitle } from '#app/utils/misc.tsx'
import { type Route } from './+types/support.ts'

const issuesUrl = 'https://github.com/DMod-dev/netrunner-collection/issues'

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Support') },
	{
		name: 'description',
		content: 'Get help with Netrunner Collection or report a problem.',
	},
]

export default function SupportRoute() {
	return (
		<MarketingPage
			title="Support"
			lead="Something not working, or a card missing? Here's how to get help."
		>
			<h2>Report a bug or request a feature</h2>
			<p>
				Open an issue on <ExternalLink href={issuesUrl}>GitHub</ExternalLink>.
				Include what you were doing, what you expected and what happened
				instead; a screenshot helps.
			</p>
			<h2>Missing or wrong card data</h2>
			<p>
				Cards and sets come from{' '}
				<ExternalLink href="https://netrunnerdb.com">NetrunnerDB</ExternalLink>.
				New releases appear here after the next sync. If a card is wrong on
				NetrunnerDB too, it's best fixed there.
			</p>
			<h2>Your account</h2>
			<ul>
				<li>
					Forgot your password? <Link to="/forgot-password">Reset it here</Link>
					.
				</li>
				<li>
					Change your email, password, passkeys or two-factor authentication in{' '}
					<Link to="/settings/profile">settings</Link>.
				</li>
				<li>
					Want a copy of your collection? Use{' '}
					<Link to="/collection/import-export">import &amp; export</Link>, or
					download all your data from settings.
				</li>
			</ul>
		</MarketingPage>
	)
}
