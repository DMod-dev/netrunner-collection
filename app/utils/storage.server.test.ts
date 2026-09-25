import fs from 'node:fs'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { deleteProfileImage, uploadProfileImage } from './storage.server.ts'

const UPLOADED_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'uploaded')

test('a deleted profile image is removed from the bucket', async () => {
	const file = new File([Uint8Array.from([1, 2, 3])], 'profile.webp', {
		type: 'image/webp',
	})
	const key = await uploadProfileImage('storage-test-user', file)
	const storedPath = path.join(UPLOADED_DIR, ...key.split('/'))
	expect(fs.existsSync(storedPath)).toBe(true)

	await deleteProfileImage(key)

	expect(fs.existsSync(storedPath)).toBe(false)
})

test('only user uploads can be deleted', async () => {
	const fetchSpy = vi.spyOn(globalThis, 'fetch')

	await deleteProfileImage('../somewhere-else')
	await deleteProfileImage('card-images/01001.webp')
	await deleteProfileImage('users/../card-images/01001.webp')

	expect(fetchSpy).not.toHaveBeenCalled()
	fetchSpy.mockRestore()
})
