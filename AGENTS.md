# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js TypeScript bridge between NapCat OneBot v11 and Discord. Runtime code lives in `src/`: `index.ts` starts the service, `bridge.ts` wires Discord and QQ events, `onebot.ts` manages the NapCat WebSocket client, `converters.ts` and `cq.ts` handle message format conversion, and `config.ts` loads environment settings. Tests live in `test/`, currently focused on CQ and Discord conversion behavior. `dist/` and `node_modules/` are generated and should not be edited directly.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: run the bot with `tsx watch src/index.ts` for local development.
- `npm run build`: compile TypeScript into `dist/`.
- `npm start`: run the compiled service from `dist/index.js`.
- `npm run typecheck`: validate TypeScript without emitting files.
- `npm test`: run the Vitest test suite.
- `npm audit`: check dependency advisories before delivery.

## Coding Style & Naming Conventions

Use strict TypeScript with ESM imports and explicit `.js` import suffixes for local modules. Keep two-space indentation, semicolons, and concise named exports. Use `PascalCase` for classes and exported interfaces, `camelCase` for functions and variables, and short lowercase filenames such as `cq.ts`. Prefer typed conversion helpers over inline string manipulation in the bridge runtime.

## Testing Guidelines

Tests use Vitest and should be named `*.test.ts` under `test/`. Add focused tests for every new CQ segment, Discord token, attachment type, or mapping rule. Converter tests should assert both message content and side effects such as Discord file URLs or OneBot segment arrays. Run `npm test` and `npm run typecheck` before submitting changes.

## Commit & Pull Request Guidelines

This workspace has no Git history yet, so use Conventional Commits going forward, for example `feat(bridge): map discord emoji to qq face` or `fix(cq): preserve escaped commas`. Pull requests should describe the bridge behavior changed, list required `.env` updates, include test results, and call out any live NapCat or Discord verification performed.

## Security & Configuration Tips

Never commit `.env`, bot tokens, QQ IDs intended to stay private, or NapCat access tokens. Update `.env.example` when adding configuration keys, and document whether each mapping is optional or required. Keep `ALLOW_EVERYONE_MENTIONS=false` unless broad Discord pings are explicitly intended.
