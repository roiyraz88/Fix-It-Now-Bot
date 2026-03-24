import { NextResponse } from 'next/server';
import Job from '@/models/Job';
import dbConnect from '@/lib/mongodb';
import { sendInteractiveButtonsReply } from '@/lib/green-api';

const THIRTY_MIN_MS = 30 * 60 * 1000;

function clientChatIdFromPhone(clientPhone: string): string {
  const clean = (clientPhone || '').replace(/\D/g, '');
  const intl = clean.startsWith('972') ? clean : clean.startsWith('0') ? '972' + clean.slice(1) : '972' + clean;
  return `${intl}@c.us`;
}

/**
 * Scheduled GET – every ~5 min (external cron on Hobby; Vercel Cron on Pro if configured).
 * One-time: sends client the "more offers?" question ~30 min after pros were first notified (clientFollowUpSent prevents repeats).
 * Set CRON_SECRET; caller must send Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await dbConnect();
  const cutoff = new Date(Date.now() - THIRTY_MIN_MS);

  const jobs = await Job.find({
    firstProsNotifiedAt: { $lte: cutoff },
    clientFollowUpSent: { $ne: true },
    acceptingMorePros: { $ne: false },
    status: { $in: ['waiting_for_offers', 'searching_professionals'] },
  }).limit(50);

  let sent = 0;
  const errors: string[] = [];

  for (const job of jobs) {
    try {
      await sendInteractiveButtonsReply(
        clientChatIdFromPhone(job.clientPhone),
        'האם כבר סגרת עם בעל מקצוע, או שאת/ה מעוניין/ת בהצעות נוספות?',
        [
          {
            buttonId: `follow_more_closed_pro_${job.shortId}`,
            buttonText: 'סגרתי, נא להפסיק הצעות',
          },
          {
            buttonId: `follow_more_stop_offers_${job.shortId}`,
            buttonText: 'לא סגרתי, נא להפסיק הצעות',
          },
          {
            buttonId: `follow_more_yes_${job.shortId}`,
            buttonText: 'אשמח לקבל הצעות נוספות',
          },
        ],
        'FixItNow 🛠️',
        'נא לבחור'
      );
      job.clientFollowUpSent = true;
      await job.save();
      sent++;
    } catch (e) {
      errors.push(`#${job.shortId}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: jobs.length,
    sent,
    errors: errors.length ? errors : undefined,
  });
}
