import { randomUUID } from "node:crypto";
import type { AuditLog, JsonValue } from "../audit/audit.js";
import type { Intake } from "../llm/mock.js";
import type { PipelineResult } from "../pipeline/pipeline.js";

export type RecurringPayment = {
  id: string;
  contactId: string;
  amount: string;
  /** ISO 4217 code of a configured demo unit. */
  currency: string;
  intervalSeconds: number;
  nextRunAt: number;
  active: boolean;
  lastResult?: PipelineResult;
};
export interface ScheduledActionRunner { run(intake: Intake): Promise<PipelineResult> }

export class RecurringScheduler {
  private readonly jobs = new Map<string, RecurringPayment>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly runner: ScheduledActionRunner, private readonly audit: AuditLog) {}

  add(input: { contactId: string; amount: string; currency?: string; intervalSeconds: number; nextRunAt?: number }): RecurringPayment {
    const job: RecurringPayment = {
      id: randomUUID(),
      contactId: input.contactId.toLowerCase(),
      amount: input.amount,
      currency: input.currency ?? "USD",
      intervalSeconds: input.intervalSeconds,
      nextRunAt: input.nextRunAt ?? Math.floor(Date.now() / 1000) + input.intervalSeconds,
      active: true,
    };
    this.jobs.set(job.id, job);
    this.log("recurring_created", job);
    return job;
  }

  cancel(id: string): RecurringPayment {
    const job = this.require(id);
    job.active = false;
    this.log("recurring_cancelled", job);
    return job;
  }

  list(): RecurringPayment[] { return [...this.jobs.values()]; }

  async runDue(now = Math.floor(Date.now() / 1000)): Promise<RecurringPayment[]> {
    const due = this.list().filter((job) => job.active && job.nextRunAt <= now);
    for (const job of due) {
      job.lastResult = await this.runner.run({
        message: `Pay ${job.contactId} ${job.amount} ${job.currency}`,
        source: "trusted",
        sourceRefs: [`recurring:${job.id}`],
      });
      do job.nextRunAt += job.intervalSeconds; while (job.nextRunAt <= now);
      this.log("recurring_run", job);
    }
    return due;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runDue(); }, 60_000);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private require(id: string): RecurringPayment {
    const job = this.jobs.get(id);
    if (!job) throw new Error("recurring payment not found");
    return job;
  }

  private log(kind: string, job: RecurringPayment): void {
    this.audit.append({ timestamp: new Date().toISOString(), kind, data: JSON.parse(JSON.stringify(job)) as JsonValue });
  }
}
