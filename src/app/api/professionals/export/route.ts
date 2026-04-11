import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Professional from '@/models/Professional';

const CSV_COLUMNS = [
  'name',
  'phone',
  'profession',
  'city',
  'experienceYears',
  'verified',
  'aboutMe',
  'profilePhotoUrl',
  'description',
] as const;

function escapeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  await dbConnect();
  const pros = await Professional.find({}).sort({ name: 1 }).lean();

  const header = CSV_COLUMNS.join(',');
  const lines = pros.map((p) =>
    CSV_COLUMNS.map((col) => escapeCsvCell((p as Record<string, unknown>)[col])).join(',')
  );
  const csv = '\uFEFF' + [header, ...lines].join('\r\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="professionals-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
