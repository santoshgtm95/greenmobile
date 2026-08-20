import { randomUUID } from 'node:crypto';

/**
 * Primary keys are UUIDs rather than auto-increment integers so that records
 * created on different machines can be merged if multi-PC or cloud sync is
 * added later (spec §94) without renumbering history.
 */
export function newId(): string {
  return randomUUID();
}
