import { Link } from 'react-router'
import { MarketingPage } from '#app/components/marketing-page.tsx'
import { pageTitle } from '#app/utils/misc.tsx'
import { type Route } from './+types/privacy.ts'

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Privacy') },
	{
		name: 'description',
		content: 'What Netrunner Collection stores about you and why.',
	},
]

export default function PrivacyRoute() {
	return (
		<MarketingPage
			title="Privacy"
			lead="We keep only what the site needs to work, and we don't sell or share it for advertising."
		>
			<h2>What we store</h2>
			<ul>
				<li>
					<strong>Account details:</strong> your email address, username, an
					optional display name and profile photo, and your password (hashed,
					never in plain text), passkeys and two-factor settings.
				</li>
				<li>
					<strong>Connected accounts:</strong> if you log in with GitHub, the ID
					of that account so we can recognise you next time.
				</li>
				<li>
					<strong>Your collection:</strong> the cards and printings you own,
					their quantities and your art preferences.
				</li>
				<li>
					<strong>Sessions:</strong> a record of each device you're logged in
					on, so you can sign out of them from settings.
				</li>
			</ul>
			<h2>Cookies</h2>
			<p>
				We use cookies to keep you logged in, remember your light/dark theme and
				show one-off messages after an action. There are no advertising or
				third-party tracking cookies.
			</p>
			<h2>Services we use</h2>
			<ul>
				<li>Email delivery, for verification codes and account notices.</li>
				<li>
					Error monitoring, to find and fix bugs. Error reports can include the
					page you were on.
				</li>
				<li>File storage, for profile photos.</li>
				<li>Hosting, where the database and the site run.</li>
			</ul>
			<h2>Your choices</h2>
			<p>
				You can download everything we store about you, or change and remove
				your details, from <Link to="/settings/profile">settings</Link>.
				Deleting your account removes your data. Questions? See{' '}
				<Link to="/support">support</Link>.
			</p>
		</MarketingPage>
	)
}
