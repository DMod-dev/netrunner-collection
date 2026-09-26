import { Link } from 'react-router'
import { MarketingPage } from '#app/components/marketing-page.tsx'
import { pageTitle } from '#app/utils/misc.tsx'
import { type Route } from './+types/tos.ts'

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Terms of service') },
	{
		name: 'description',
		content: 'The terms for using Netrunner Collection.',
	},
]

export default function TermsOfServiceRoute() {
	return (
		<MarketingPage
			title="Terms of service"
			lead="The short version: it's a free fan project, use it fairly, and keep your own backups."
		>
			<h2>Using the site</h2>
			<ul>
				<li>
					Keep your login details to yourself; you're responsible for activity
					on your account.
				</li>
				<li>
					Don't try to break, overload or scrape the site, or access other
					people's accounts.
				</li>
				<li>
					Your username, display name and photo should be something you'd be
					happy for others to see.
				</li>
			</ul>
			<h2>Your data</h2>
			<p>
				Your collection is yours. You can export it or delete your account at
				any time. See the <Link to="/privacy">privacy policy</Link> for what we
				store.
			</p>
			<h2>No guarantees</h2>
			<p>
				The site is provided as is, for free. We do our best to keep it running
				and your data safe, but can't promise it will always be available or
				error-free, so export your collection now and then. We may change or
				shut down the site, and will give notice where we can.
			</p>
			<h2>Card content</h2>
			<p>
				Netrunner is a trademark of Wizards of the Coast LLC. Card text and
				images belong to their respective owners and come from NetrunnerDB. This
				site is not affiliated with or endorsed by Wizards of the Coast, Fantasy
				Flight Games or Null Signal Games.
			</p>
			<h2>Changes</h2>
			<p>
				We may update these terms. If a change matters, we'll say so on the
				site. Using it after that means you accept the new terms.
			</p>
		</MarketingPage>
	)
}
