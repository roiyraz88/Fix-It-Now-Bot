import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Professional from '@/models/Professional';
import { sendMessage } from '@/lib/green-api';
import { requireAdmin } from '@/lib/admin-auth';

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const message = (body.message as string)?.trim();
    if (!message) {
      return NextResponse.json({ error: 'נדרשת הודעה' }, { status: 400 });
    }

    await dbConnect();
    const pros = await Professional.find({});
    const errors: string[] = [];
    let sent = 0;

    const text = `FixItNow\n\n${message}`;

    for (const pro of pros) {
      const cleanPhone = pro.phone.replace(/\D/g, '');
      if (!cleanPhone) {
        errors.push(`${pro.name}: אין מספר טלפון`);
        continue;
      }
      try {
        await sendMessage(cleanPhone, text);
        sent++;
      } catch (e) {
        errors.push(`${pro.name}: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      total: pros.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
