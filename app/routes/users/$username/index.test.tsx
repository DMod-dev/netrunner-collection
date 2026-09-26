/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub, RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { loader as rootLoader } from '#app/root.tsx'
import { getSessionExpirationDate, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { parseSetCookieHeader } from '#tests/utils.ts'
import { default as UsernameRoute, loader } from './index.tsx'

async function createSignedInUser() {
	const user = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
	})
	const authSession = await authSessionStorage.getSession()
	authSession.set(sessionKey, session.id)
	const parsedCookie = parseSetCookieHeader(
		await authSessionStorage.commitSession(authSession),
	)
	const cookieHeader = new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()
	return { user, cookieHeader }
}

test('Profiles are only visible to signed-in users', async () => {
	const user = await prisma.user.create({
		select: { username: true },
		data: createUser(),
	})
	const request = new Request(`http://localhost/users/${user.username}`)

	const response = await loader({
		request,
		url: new URL(request.url),
		pattern: '/users/:username',
		params: { username: user.username },
		context: new RouterContextProvider(),
	}).catch((thrown: unknown) => thrown)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	expect((response as Response).headers.get('location')).toBe(
		`/login?${new URLSearchParams({ redirectTo: `/users/${user.username}` })}`,
	)
})

test('The user profile when signed in as someone else', async () => {
	const user = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const { cookieHeader } = await createSignedInUser()
	renderProfile(user.username, cookieHeader)

	await screen.findByRole('heading', { level: 1, name: user.name! })
	expect(screen.queryByRole('link', { name: /edit profile/i })).toBeNull()
	// their collection stats show, but don't link to your own collection
	expect(screen.getByText('0 cards · 0 copies')).toBeInTheDocument()
	expect(screen.queryByRole('link', { name: /0 cards/i })).toBeNull()
	// they haven't shared it with you
	expect(screen.queryByRole('link', { name: /view collection/i })).toBeNull()
})

test('The user profile links to a collection they shared with you', async () => {
	const owner = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const { user: viewer, cookieHeader } = await createSignedInUser()
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	renderProfile(owner.username, cookieHeader)

	await screen.findByRole('heading', { level: 1, name: owner.name! })
	expect(
		screen.getByRole('link', { name: /view collection/i }),
	).toHaveAttribute('href', `/users/${owner.username}/collection`)
})

test('A share you gave doesn’t link you to their collection', async () => {
	const other = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const { user: me, cookieHeader } = await createSignedInUser()
	await prisma.collectionShare.create({
		data: { ownerId: me.id, viewerId: other.id },
	})
	renderProfile(other.username, cookieHeader)

	await screen.findByRole('heading', { level: 1, name: other.name! })
	expect(screen.queryByRole('link', { name: /view collection/i })).toBeNull()
})

function renderProfile(username: string, cookieHeader: string) {
	const App = createRoutesStub([
		{
			path: '/users/:username',
			Component: UsernameRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookieHeader)
				return loader(args)
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
	])
	render(<App initialEntries={[`/users/${username}`]} />)
}

test('The user profile when logged in as self', async () => {
	const user = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: {
			expirationDate: getSessionExpirationDate(),
			userId: user.id,
		},
	})

	const authSession = await authSessionStorage.getSession()
	authSession.set(sessionKey, session.id)
	const setCookieHeader = await authSessionStorage.commitSession(authSession)
	const parsedCookie = parseSetCookieHeader(setCookieHeader)
	const cookieHeader = new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()

	const App = createRoutesStub([
		{
			id: 'root',
			path: '/',
			loader: async (args) => {
				// add the cookie header to the request
				args.request.headers.set('cookie', cookieHeader)
				return rootLoader({ ...args, context: args.context })
			},
			HydrateFallback: () => <div>Loading...</div>,
			children: [
				{
					path: 'users/:username',
					Component: UsernameRoute,
					loader: async (args) => {
						// add the cookie header to the request
						args.request.headers.set('cookie', cookieHeader)
						return loader(args)
					},
				},
			],
		},
	])

	const routeUrl = `/users/${user.username}`
	render(<App initialEntries={[routeUrl]} />)

	await screen.findByRole('heading', { level: 1, name: user.name! })
	await screen.findByRole('button', { name: /logout/i })
	await screen.findByRole('link', { name: /my collection/i })
	// your own collection is "My collection", not a shared one
	expect(screen.queryByRole('link', { name: /view collection/i })).toBeNull()
	expect(
		screen.getByRole('link', { name: '0 cards · 0 copies' }),
	).toHaveAttribute('href', '/collection')
	expect(
		await screen.findByRole('link', { name: /edit profile/i }),
	).toBeInTheDocument()
})
