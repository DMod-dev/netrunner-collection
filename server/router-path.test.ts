import { expect, test } from 'vitest'
import { routerPath } from './router-path.ts'

test.each([
	['/login', '/login'],
	['/LOGIN', '/login'],
	['/Reset-Password', '/reset-password'],
	['/%6cogin', '/login'],
	['/collection/import-export/', '/collection/import-export'],
	['/Collection/Import-Export.data', '/collection/import-export.data'],
	['/Resources/Images', '/resources/images'],
	['/bad%E0%A4%A', '/bad%e0%a4%a'],
])('%s is matched as %s', (path, expected) => {
	expect(routerPath(path)).toBe(expected)
})
