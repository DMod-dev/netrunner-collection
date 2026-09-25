import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
		seed: 'tsx prisma/seed.ts',
	},
	datasource: {
		// Read the env var directly rather than via `env()`, which throws when
		// it's unset: the Docker build runs `prisma generate` without a database.
		url: process.env.DATABASE_URL,
	},
})
