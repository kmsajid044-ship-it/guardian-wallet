# scheduler

Recurring payments are timing metadata only. `RecurringScheduler` never receives a signer; each due
occurrence calls the same `AgentPipeline.run` entry point as owner chat, with a `recurring:<id>` source
reference. This preserves firewall, live policy pre-check, simulation, risk routing, explanation, and
hash-chained audit behavior for scheduled actions. See SPEC.md §7.1 and §7.4.
