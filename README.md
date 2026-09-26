# Netrunner Collection

Track which Netrunner cards you own, down to the printing and alt art.

Search every card from the original Core Set to the latest Null Signal Games
release, record how many copies you own of each printing, and see which sets
you've completed and which cards you still need for a deck. Card data comes from
[NetrunnerDB](https://netrunnerdb.com).

## Features

- **Collection:** search and filter by side, faction, type and set. Log copies
  per printing, including alt arts and promos, and pick the default art for each
  card. Cards you don't own are shown washed out.
- **Set completion:** progress for every set, down to which cards are missing.
- **Deck check:** paste a decklist and see what you're short.
- **Import and export:** a CSV of your collection.
- **Accounts:** email and password, passkeys, two-factor authentication and
  GitHub login.
- **Card data sync:** card data is mirrored from NetrunnerDB automatically once
  a day. Admins can trigger a sync from **Card data sync** in the user menu.

## Tech stack

Built on the [Epic Stack](https://www.epicweb.dev/epic-stack):

- React Router 8 (framework mode).
- shadcn/ui (Base UI) and Tailwind CSS v4.
- Prisma with SQLite, replicated with LiteFS.
- Deployed to Fly.io.
- Vitest and Playwright for tests; oxlint and oxfmt for linting and formatting.

## Getting started

You need Node 22.

```sh
npm install
cp .env.example .env
npm run setup          # build, apply migrations, install Playwright
npx prisma db seed     # optional: admin user "kody" / "kodylovesyou"
npm run sync:nrdb      # pull card data from NetrunnerDB
npm run dev
```

The app runs at http://localhost:3000. `npm run dev` mocks outside services such
as email and GitHub. Emails are printed to the terminal instead of being sent.
Use `npm run dev:no-mocks` to call the real services.

The scheduled NetrunnerDB sync is off when mocks are on. Run `npm run sync:nrdb`
whenever you want fresh card data locally.

## Scripts

| Script              | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Dev server with mocks                                      |
| `npm run build`     | Production build                                           |
| `npm run sync:nrdb` | Sync cards, sets and printings from NetrunnerDB            |
| `npm test`          | Unit tests (Vitest, watch mode)                            |
| `npm run test:e2e`  | End-to-end tests (Playwright UI)                           |
| `npm run lint`      | oxlint with type-aware rules                               |
| `npm run format`    | Format with oxfmt                                          |
| `npm run typecheck` | Generate route types and run `tsc`                         |
| `npm run validate`  | Unit tests, lint, typecheck, format check and e2e together |

## Project layout

```
app/
  routes/          file-based routes (react-router-auto-routes)
    collection/    collection, sets, deck check, import/export
    users/         profiles, and read-only views of collections shared with you
    admin/         card data sync and cache admin
    settings/      profile, password, passkeys, 2FA, connections
  components/      shared UI; components/ui holds the shadcn primitives
    collection-pages/  the Cards and Sets pages, used by both route trees
  utils/           server and client helpers (*.server.ts stays on the server)
prisma/            schema, migrations and seed
other/             Dockerfile, LiteFS config and the sync-nrdb script
tests/e2e/         Playwright tests
docs/              Epic Stack docs (deployment, secrets, testing and more)
```

## Deployment

GitHub Actions runs lint, typecheck, Vitest and Playwright on every push:

- Pushes to `main` deploy to production on Fly.io.
- Pushes to `dev` deploy to staging.

Migrations run on startup with `prisma migrate deploy`. See
[docs/deployment.md](docs/deployment.md) for first-time Fly setup and
[docs/secrets.md](docs/secrets.md) for the environment variables.

## Acknowledgements

- Card data and images come from [NetrunnerDB](https://netrunnerdb.com).
- The project started from Kent C. Dodds'
  [Epic Stack](https://github.com/epicweb-dev/epic-stack).

Netrunner is a trademark of Wizards of the Coast LLC. This project is not
affiliated with or endorsed by Wizards of the Coast, Fantasy Flight Games or
Null Signal Games.
