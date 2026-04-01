import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';

function dbCheckPayload(error: unknown) {
  const err = error as Error & { name?: string; code?: number };
  const message = err?.message || String(error);
  const name = err?.name || 'Error';
  const hint =
    name === 'MongooseServerSelectionError' || /whitelist|Server selection timed out/i.test(message)
      ? 'MongoDB Atlas → Network Access: allow 0.0.0.0/0 (or your host IPs). Confirm MONGODB_URI on Vercel and cluster is not paused.'
      : undefined;
  return { ok: false as const, status: 'error' as const, name, message, hint };
}

export async function GET() {
  try {
    await dbConnect();
    let pingOk = false;
    try {
      const r = await mongoose.connection.db?.admin().ping();
      pingOk = r?.ok === 1;
    } catch {
      pingOk = false;
    }
    return NextResponse.json({
      ok: true,
      status: 'connected',
      ping: pingOk,
    });
  } catch (error) {
    const body = dbCheckPayload(error);
    // 503 = service unavailable (DB), not a bug in this route
    return NextResponse.json(body, { status: 503 });
  }
}

