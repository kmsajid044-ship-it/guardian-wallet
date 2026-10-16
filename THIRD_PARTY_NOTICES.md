# Third-Party Notices

Guardian Wallet is MIT-licensed. All project code is written by the team. It depends on the
third-party packages below, all under licenses compatible with MIT. Full license texts ship
with each package (`node_modules/<pkg>/LICENSE`, `contracts/lib/forge-std/LICENSE-*`).

Keep this list updated whenever a direct dependency is added (CLAUDE.md conventions).

## Smart contracts
| Package | Version | License | Use |
|---|---|---|---|
| @openzeppelin/contracts | 5.6.1 | MIT | Access control and reentrancy protection |
| forge-std (vendored in `contracts/lib/forge-std`) | 1.17.0 | MIT OR Apache-2.0 | Foundry test and script helpers |
| Foundry toolchain (forge, anvil, cast) | 1.8.5 | MIT OR Apache-2.0 | Build, test, local chain (tool, not redistributed) |

## Agent service
| Package | Version | License |
|---|---|---|
| fastify | 5.12.7 | MIT |
| viem | 2.57.6 | MIT |
| zod | 4.6.7 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| node-cron | 4.6.0 | ISC |
| dotenv | 18.0.7 | BSD-2-Clause |

## Web app
| Package | Version | License |
|---|---|---|
| react, react-dom | 19.3.0 | MIT |
| viem | 2.57.6 | MIT |
| tailwindcss, @tailwindcss/vite | 4.3.3 | MIT |
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |

## Eval harness
| Package | Version | License |
|---|---|---|
| yaml | 2.9.1 | ISC |
| zod, viem | see above | MIT |

## Development tooling (not shipped)
| Package | License |
|---|---|
| typescript | Apache-2.0 |
| tsx, vitest, eslint, @eslint/js, typescript-eslint | MIT |
| @types/* (DefinitelyTyped) | MIT |
