import { Link } from 'react-router'
import { ExternalLink, MarketingPage } from '#app/components/marketing-page.tsx'
import { pageTitle } from '#app/utils/misc.tsx'
import { type Route } from './+types/about.ts'

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('About') },
	{
		name: 'description',
		content:
			'Netrunner Collection is a free tool for tracking the Netrunner cards you own.',
	},
]

export default function AboutRoute() {
	return (
		<MarketingPage
			title="About"
			lead="Netrunner Collection is a free, fan-made tool for keeping track of the Netrunner cards you own."
		>
			<p>
				Search every card from the original Core Set to the latest Null Signal
				Games release, record how many copies you own of each printing, and see
				at a glance which sets you've completed and which cards you're still
				missing for a deck.
			</p>
			<h2>What you can do</h2>
			<ul>
				<li>Track copies per printing, including alt arts and promos.</li>
				<li>
					Filter by side, faction, type and set, and pick the art you want to
					see.
				</li>
				<li>
					Check set completion and whether you own enough copies for a deck.
				</li>
				<li>Import and export your collection as a spreadsheet.</li>
			</ul>
			<h2>Card data</h2>
			<p>
				Card text, sets and images come from{' '}
				<ExternalLink href="https://netrunnerdb.com">NetrunnerDB</ExternalLink>,
				synced regularly so new releases show up without any work on your part.
			</p>
			<h2>The fine print</h2>
			<p>
				Netrunner is a trademark of Wizards of the Coast LLC. This site is not
				affiliated with or endorsed by Wizards of the Coast, Fantasy Flight
				Games or Null Signal Games. See the <Link to="/tos">terms</Link> and{' '}
				<Link to="/privacy">privacy policy</Link> for how the site works.
			</p>
		</MarketingPage>
	)
}
