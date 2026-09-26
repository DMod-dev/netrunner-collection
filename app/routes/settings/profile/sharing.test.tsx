/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import {
	default as SharedWithMeRoute,
	action as sharedAction,
	loader as sharedLoader,
} from '#app/routes/collection/shared.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { default as SharingRoute, action, loader } from './sharing.tsx'

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

/** Both pages, signed in as `userId`. */
async function renderAs(userId: string, path: string) {
	const cookie = await cookieFor(userId)
	// the stub's args are untyped; the paths below have what these need
	const App = createRoutesStub([
		{
			path: '/settings/profile/sharing',
			Component: SharingRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				return loader(args as Parameters<typeof loader>[0])
			},
			action: async (args) => {
				args.request.headers.set('cookie', cookie)
				return action(args as Parameters<typeof action>[0])
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
		{
			path: '/collection/shared',
			Component: SharedWithMeRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				return sharedLoader(args as Parameters<typeof sharedLoader>[0])
			},
			action: async (args) => {
				args.request.headers.set('cookie', cookie)
				return sharedAction(args as Parameters<typeof sharedAction>[0])
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
	])
	return render(<App initialEntries={[path]} />)
}

test('the owner adds a viewer by username, with inline errors', async () => {
	const user = userEvent.setup()
	const owner = await insertUser()
	const viewer = await insertUser()
	await renderAs(owner.id, '/settings/profile/sharing')

	await screen.findByText('Your collection isn’t shared with anyone.')
	const input = () =>
		screen.getByRole('textbox', { name: 'Share with username' })
	const share = screen.getByRole('button', { name: 'Share' })

	await user.type(input(), owner.username)
	await user.click(share)
	expect(await screen.findByText('That’s you')).toBeInTheDocument()

	await user.clear(input())
	await user.type(input(), 'nobody_here')
	await user.click(share)
	expect(
		await screen.findByText('No user with that username'),
	).toBeInTheDocument()
	expect(await prisma.collectionShare.count()).toBe(0)

	await user.clear(input())
	await user.type(input(), viewer.username)
	await user.click(share)
	const list = await screen.findByRole('list')
	expect(within(list).getByText(viewer.name!)).toBeInTheDocument()
	expect(
		within(list).getByRole('button', {
			name: `Stop sharing with ${viewer.name}`,
		}),
	).toBeInTheDocument()
	expect(input()).toHaveValue('')

	// user-event doesn't see form.reset(), so it would type after the old text
	await user.clear(input())
	await user.type(input(), viewer.username)
	await user.click(share)
	expect(
		await screen.findByText('Already shared with this user'),
	).toBeInTheDocument()
	expect(await prisma.collectionShare.count()).toBe(1)
})

test('the viewer sees shared collections and can remove one', async () => {
	const user = userEvent.setup()
	const owner = await insertUser()
	const viewer = await insertUser()
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	await renderAs(viewer.id, '/collection/shared')

	const link = await screen.findByRole('link', {
		name: new RegExp(`${owner.name}’s collection`),
	})
	expect(link).toHaveAttribute('href', `/users/${owner.username}/collection`)

	const remove = screen.getByRole('button', {
		name: `Remove ${owner.name}’s collection`,
	})
	await user.click(remove)
	await user.click(screen.getByRole('button', { name: 'Are you sure?' }))

	await screen.findByText('Nothing shared with you yet')
	expect(await prisma.collectionShare.count()).toBe(0)
})
