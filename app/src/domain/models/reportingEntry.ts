import { z } from 'zod';
import { TargetType } from './assignment.js';

/**
 * Reporting index entry — Forge Custom Entity Store, keyed `{issueId}:{kpiId}`,
 * indexed on `kpiId`. Brief §4.3. Rebuilt on assignment save; target dates are
 * resolved lazily at reporting-render time (store the rule, not the date).
 */
export const ReportingEntry = z.object({
  issueId: z.string().min(1),
  issueKey: z.string().min(1),
  kpiId: z.string().min(1),
  issueTypeName: z.string().min(1),
  hierarchyLevel: z.number().int().nonnegative(),
  target: z.number().nullable(),
  targetType: TargetType,
  parentIssueId: z.string().nullable(),
});
export type ReportingEntry = z.infer<typeof ReportingEntry>;
