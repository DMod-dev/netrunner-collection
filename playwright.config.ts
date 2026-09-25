import { defineConfig, devices } from '@playwright/test'
import 'dotenv/config'

const PORT = process.env.PORT || '3000'
// Outside CI the tests run against `npm run dev`, which compiles modules on
// first request and serves them unbundled: the first page takes ~10 s and every
// page loads and hydrates several times slower than the production build CI
// uses. Warm it up once, and give each test and assertion more room.
const DEV_SERVER = !process.env.CI
export default defineConfig({
	testDir: './tests/e2e',
	globalSetup: DEV_SERVER ? './tests/setup/playwright-warmup.ts' : undefined,
	timeout: (DEV_SERVER ? 60 : 15) * 1000,
	expect: {
		timeout: (DEV_SERVER ? 15 : 5) * 1000,
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: `http://localhost:${PORT}/`,
		trace: 'on-first-retry',
	},

	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
			},
		},
	],

	webServer: {
		command: process.env.CI ? 'npm run start:mocks' : 'npm run dev',
		port: Number(PORT),
		timeout: 60 * 1000,
		reuseExistingServer: true,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			PORT,
			NODE_ENV: 'test',
		},
	},
})
