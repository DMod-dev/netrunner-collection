/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { loader as rootLoader } from '#app/root.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { setPreferredGame } from '#app/utils/game.server.ts'
import { type Game } from '#app/utils/game.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { default as SharedWithMeRoute, loader } from './shared.tsx'

/** Shared with me for a viewer whose preferred game is `game`. */
async function renderSharedWithMe(game: Game) {
	const owner = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const viewer = await prisma.user.create({
		select: { id: true },
		data: createUser(),
	})
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: viewer.id },
	})
	const cookie = [
		await getSessionCookieHeader(session),
		setPreferredGame(game).split(';')[0],
	].join('; ')

	const App = createRoutesStub([
		{
			id: 'root',
			path: '/',
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				return rootLoader(args)
			},
			HydrateFallback: () => <div>Loading...</div>,
			children: [
				{
					path: 'collection/shared',
					Component: SharedWithMeRoute,
					loader: async (args) => {
						args.request.headers.set('cookie', cookie)
						return loader(args)
					},
				},
			],
		},
	])
	render(<App initialEntries={['/collection/shared']} />)
	await screen.findByRole('heading', { level: 1, name: 'Shared with me' })
	return { owner, name: owner.name ?? owner.username }
}

test('with Netrunner chosen, a share opens the Netrunner collection', async () => {
	const { owner, name } = await renderSharedWithMe('netrunner')
	expect(
		screen.getByRole('link', { name: new RegExp(`^${name}’s collection`) }),
	).toHaveAttribute('href', `/users/${owner.username}/collection`)
	expect(screen.getByText('0 cards · 0 copies')).toBeInTheDocument()
	expect(
		screen.getByRole('link', { name: `${name}’s MTG collection` }),
	).toHaveAttribute('href', `/users/${owner.username}/mtg/collection`)
})

test('with MTG chosen, a share opens the MTG collection', async () => {
	const { owner, name } = await renderSharedWithMe('mtg')
	expect(
		screen.getByRole('link', { name: `${name}’s MTG collection` }),
	).toHaveAttribute('href', `/users/${owner.username}/mtg/collection`)
	// the counts are the Netrunner collection's, so they don't show here
	expect(screen.queryByText(/copies/)).toBeNull()
	expect(
		screen.getByRole('link', { name: `${name}’s Netrunner collection` }),
	).toHaveAttribute('href', `/users/${owner.username}/collection`)
	// and the tabs are MTG's
	expect(screen.getByRole('link', { name: 'Import/Export' })).toHaveAttribute(
		'href',
		'/mtg/collection/import-export',
	)
})
