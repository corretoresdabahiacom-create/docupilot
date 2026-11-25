import { and, isNotNull, lt, or } from 'drizzle-orm';
import {
  auditLogs,
  organizationInvites,
  rateLimitCounters,
  reports,
  sessions,
  sharedLinks,
} from './db/schema';
import type { Db } from './types';

const DAY = 86_400_000;

/** Retenção do briefing (§17): auditoria 180 d; links expirados +30 d; sessões; denúncias 180 d. */
export const RETENTION = {
  auditLogsDays: 180,
  expiredLinksDays: 30,
  resolvedReportsDays: 180,
  usedInvitesDays: 30,
  rateLimitDays: 1,
} as const;

export interface RetentionResult {
  auditLogs: number;
  sessions: number;
  sharedLinks: number;
  reports: number;
  invites: number;
  rateLimitCounters: number;
}

export async function runRetention(db: Db, now = Date.now()): Promise<RetentionResult> {
  const count = async (q: Promise<{ id?: string; key?: string }[]>) => (await q).length;
  return {
    auditLogs: await count(
      db
        .delete(auditLogs)
        .where(lt(auditLogs.createdAt, now - RETENTION.auditLogsDays * DAY))
        .returning({ id: auditLogs.id }),
    ),
    sessions: await count(
      db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id }),
    ),
    sharedLinks: await count(
      db
        .delete(sharedLinks)
        .where(lt(sharedLinks.expiresAt, now - RETENTION.expiredLinksDays * DAY))
        .returning({ id: sharedLinks.id }),
    ),
    reports: await count(
      db
        .delete(reports)
        .where(
          and(
            isNotNull(reports.resolvedAt),
            lt(reports.resolvedAt, now - RETENTION.resolvedReportsDays * DAY),
          ),
        )
        .returning({ id: reports.id }),
    ),
    invites: await count(
      db
        .delete(organizationInvites)
        .where(
          or(
            and(
              isNotNull(organizationInvites.usedAt),
              lt(organizationInvites.usedAt, now - RETENTION.usedInvitesDays * DAY),
            ),
            lt(organizationInvites.expiresAt, now - RETENTION.usedInvitesDays * DAY),
          ),
        )
        .returning({ id: organizationInvites.id }),
    ),
    rateLimitCounters: await count(
      db
        .delete(rateLimitCounters)
        .where(lt(rateLimitCounters.windowStart, now - RETENTION.rateLimitDays * DAY))
        .returning({ key: rateLimitCounters.key }),
    ),
  };
}
