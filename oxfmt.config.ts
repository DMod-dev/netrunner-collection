import epicOxfmt from '@epic-web/config/oxfmt'
import { defineConfig } from 'oxfmt'

export default defineConfig({
	...epicOxfmt,
	ignorePatterns: [...(epicOxfmt.ignorePatterns ?? []), '**/.react-router/**'],
	overrides: [
		...(epicOxfmt.overrides ?? []),
		{
			// Long YAML values here are shell commands (workflow `run:` steps,
			// litefs `cmd:`), which shouldn't be rewrapped.
			files: ['**/*.yml', '**/*.yaml'],
			options: { proseWrap: 'preserve' },
		},
	],
})
