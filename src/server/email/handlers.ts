import { UUID_RE } from "@/server/db";
import type { Services } from "@/server/jobs/services";
import { JOB_TYPES, JobError, type JobHandlers } from "@/server/jobs/types";

/** What an outbox row says when nothing can send it. Admin screens show this text as the reason. */
export const EMAIL_NOT_CONFIGURED = "EMAIL_NOT_CONFIGURED";

/**
 * `send_email` is a documented no-op for now (SCALEV-AUTH-PLAN §8.9). There is no SMTP, and no flow of this app needs one:
 * buyers activate with email + phone, resets come from CS as a link. The admin screens (T7) still queue emails, so the job
 * must not die as "no handler". It does the one honest thing: mark the outbox row `failed` with EMAIL_NOT_CONFIGURED and
 * finish. Nothing is sent, nothing is retried, and the row never reads as "sent".
 *
 * To add SMTP later: replace this handler. The job payload ({ outbox_id }) and the outbox table do not change.
 * A `failed` row can be put back to `queued` by hand once a transport exists.
 */
export function emailHandlers(svc: Services): JobHandlers {
  return {
    [JOB_TYPES.sendEmail]: async (job) => {
      const id = job.payload.outbox_id;
      if (typeof id !== "string" || !UUID_RE.test(id)) throw new JobError("send_email needs payload.outbox_id", false);
      const rows = await svc.db.asService((q) =>
        q.query<{ id: string }>(
          // The address and the payload are not read here and never logged.
          `update public.email_outbox set status = 'failed', last_error = $2
           where id = $1::uuid and status in ('queued', 'sending', 'failed') returning id`,
          [id, EMAIL_NOT_CONFIGURED],
        ),
      );
      return { outbox: rows.length > 0 ? "failed" : "not_found_or_sent", reason: EMAIL_NOT_CONFIGURED };
    },
  };
}
