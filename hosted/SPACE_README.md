---
title: Guardian Wallet
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: AI finance agent with on-chain limits, local FISCO BCOS demo
---

# Guardian Wallet: online demo

A research prototype for the 2026 Shenzhen FinTechathon, International Track, Topic F: an AI agent that pays, saves, and plans on its owner's behalf, inside limits the agent cannot change. The LLM proposes. Code verifies. The contract enforces. The human decides above the line.

This Space runs a four-node FISCO BCOS network inside the container, operated by the team, with the agent API, the Risk Intel service, and the owner console. USD and CNY demo balances on a simulated ledger; no real money.

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

Notes for visitors:

- Fresh chain on every restart. "Reset demo" deploys fresh contracts and synthetic seed data on the running chain; the demo also resets itself after 30 minutes without changes.
- Every visitor acts as the demo owner, so Approve, Pause, and Resume work. The owner key is generated inside the container at start and never leaves it.
- Chat is limited to 20 requests per minute per address. The language model (when configured) has an hourly call cap; after that, or if it is unavailable, the offline rules answer.
- Recorded execution evidence (134 FISCO BCOS transactions, verified on all four nodes) and the source are in the GitHub repo: https://github.com/kmsajid044-ship-it/guardian-wallet
