import { redirect } from 'react-router'

// MTG's home is its collection, like / is Netrunner's for a logged-in user
export function loader() {
	return redirect('/mtg/collection')
}
