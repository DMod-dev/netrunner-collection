# Testing

## Prerequisites

Before running tests locally, copy `.env.example` to `.env` so Playwright and
Vitest load the required environment variables.

```sh
cp .env.example .env
```

## Playwright

We use Playwright for our End-to-End tests in this project. You'll find those in
the `tests` directory. As you make changes, add to an existing file or create a
new file in the `tests` directory to test your changes.

To run these tests in development, run `npm run test:e2e:dev` which will start
the dev server for the app and run Playwright on it.

We have a fixture for testing authenticated features without having to go
through the login flow:

```ts
test('my test', async ({ page, login }) => {
	const user = await login()
	// you are now logged in
})
```

We also auto-delete the user at the end of your test. That way, we can keep your
local db clean and keep your tests isolated from one another.

## Vitest

For lower level tests of utilities and individual components, we use `vitest`.
We have DOM-specific assertion helpers via
[`@testing-library/jest-dom`](https://testing-library.com/jest-dom).

## Type Checking

This project uses TypeScript. It's recommended to get TypeScript set up for your
editor to get a really great in-editor experience with type checking and
auto-complete. To run type checking across the whole project, run
`npm run typecheck`.

## Linting

This project uses [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) for
linting, configured in `.oxlintrc.json` on top of `@epic-web/config`. Run
`npm run lint` (or `npm run lint:fix`). Linting is type-aware, so run
`npx react-router typegen` first if the route types are out of date.

## Formatting

We use [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for
auto-formatting in this project, configured in `oxfmt.config.ts`. It's
recommended to install an editor plugin (like the
[Oxc VS Code extension](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode))
to get auto-formatting on save. There's also a `npm run format` script you can
run to format all files in the project, and `npm run format:check` to check them
without writing.
