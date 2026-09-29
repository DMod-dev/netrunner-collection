/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { loader as setsLoader } from './sets/index.tsx'
import { default as SharedMtgCollectionRoute, loader } from './index.tsx'

async function insertUser() {
	return prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId },
	})
	return getSessionCookieHeader(session)
}

/** What a loader under /users/:username/mtg/collection gets. */
async function loaderArgs(userId: string, path: string, username: string) {
	const request = new Request(`http://localhost${path}`, {
		headers: { cookie: await cookieFor(userId) },
	})
	// the same shape for every route here; `loader`'s type stands for them all
	return {
		request,
		params: { username },
		context: {},
		url: new URL(request.url),
	} as unknown as Parameters<typeof loader>[0] &
		Parameters<typeof setsLoader>[0]
}

test('a collection shared with you has its MTG page, read-only', async () => {
	const owner = await insertUser()
	const viewer = await insertUser()
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	const cookie = await cookieFor(viewer.id)
	const basePath = `/users/${owner.username}/mtg/collection`

	const App = createRoutesStub([
		{
			path: '/users/:username/mtg/collection',
			Component: SharedMtgCollectionRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				return loader(args as Parameters<typeof loader>[0])
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
	])
	render(<App initialEntries={[basePath]} />)

	await screen.findByRole('heading', {
		level: 1,
		name: `${owner.name}’s MTG collection`,
	})
	expect(
		screen.getByText(`Viewing ${owner.name}’s collection · read-only`),
	).toBeInTheDocument()
	const nav = screen.getByRole('navigation', { name: 'Collection views' })
	expect(
		within(nav)
			.getAllByRole('link')
			.map((link) => [link.textContent, link.getAttribute('href')]),
	).toEqual([
		['Cards', basePath],
		['Sets', `${basePath}/sets`],
	])
})

test('without a share the MTG collection is a 404, like the Netrunner one', async () => {
	const owner = await insertUser()
	const stranger = await insertUser()
	const cases = [
		[loader, `/users/${owner.username}/mtg/collection`],
		[setsLoader, `/users/${owner.username}/mtg/collection/sets`],
	] as const
	for (const [routeLoader, path] of cases) {
		const args = await loaderArgs(stranger.id, path, owner.username)
		const thrown = await Promise.resolve(routeLoader(args)).catch(
			(error: unknown) => error,
		)
		expect(thrown).toBeInstanceOf(Response)
		expect({ path, status: (thrown as Response).status }).toEqual({
			path,
			status: 404,
		})
	}
})

test('the owner visiting their own shared MTG URL is sent to /mtg/collection', async () => {
	const me = await insertUser()
	const args = await loaderArgs(
		me.id,
		`/users/${me.username}/mtg/collection/sets?target=playset`,
		me.username,
	)
	const thrown = await setsLoader(args).catch((error: unknown) => error)
	expect(thrown).toBeInstanceOf(Response)
	expect((thrown as Response).status).toBe(302)
	expect((thrown as Response).headers.get('location')).toBe(
		'/mtg/collection/sets?target=playset',
	)
})
