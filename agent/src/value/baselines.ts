// Time assumptions for "estimated time saved vs manual". Estimates for a research prototype,
// not measurements; docs/EVAL_REPORT.md states them next to every result that uses them.
export const manualMinutesByTask = {
  pay: 3, // open banking app, find payee, enter amount, confirm, keep a note
  approval: 5, // the same, plus checking limits and the payee before a larger payment
  save: 2,
  schedule: 4,
} as const;

/** Owner attention the agent still needs: reading one approval card, or answering one question. */
export const ownerReviewMinutes = 0.5;
export const clarificationReplyMinutes = 0.25;
