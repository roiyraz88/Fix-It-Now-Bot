import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Professional from '@/models/Professional';

const VALID_PROFESSIONS = new Set([
  'plumber',
  'electrician',
  'ac',
  'painter',
  'handyman',
  'contractor',
]);

/** Minimal RFC-style CSV row parser */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cur);
        cur = '';
        if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
        row = [];
      } else {
        cur += c;
      }
    }
  }
  row.push(cur);
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  return rows;
}

function parseBool(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'yes' || t === 'כן';
}

export async function POST(request: Request) {
  try {
    const ct = request.headers.get('content-type') || '';
    let csvText: string;

    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return NextResponse.json({ error: 'נדרש קובץ CSV בשדה file' }, { status: 400 });
      }
      csvText = await (file as File).text();
    } else {
      const body = await request.json().catch(() => ({}));
      csvText = (body.csv as string) || '';
      if (!csvText.trim()) {
        return NextResponse.json(
          { error: 'שלח csv כטקסט (שדה csv) או multipart עם file' },
          { status: 400 }
        );
      }
    }

    const rows = parseCSV(csvText.trim());
    if (rows.length < 2) {
      return NextResponse.json({ error: 'קובץ ריק או ללא שורות נתונים' }, { status: 400 });
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const idxName = col('name');
    const idxPhone = col('phone');
    const idxProfession = col('profession');
    const idxCity = col('city');
    const idxExp = col('experienceyears');
    const idxVerified = col('verified');
    const idxAbout = col('aboutme');
    const idxPhoto = col('profilephotourl');
    const idxDesc = col('description');

    if (idxPhone < 0 || idxName < 0 || idxProfession < 0 || idxCity < 0 || idxExp < 0) {
      return NextResponse.json(
        {
          error:
            'כותרות נדרשות: name, phone, profession, city, experienceYears (אופציונלי: verified, aboutMe, profilePhotoUrl, description)',
        },
        { status: 400 }
      );
    }

    await dbConnect();
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const phone = (cells[idxPhone] || '').replace(/\D/g, '');
      const name = (cells[idxName] || '').trim();
      let profession = (cells[idxProfession] || '').trim().toLowerCase();
      const city = (cells[idxCity] || '').trim();
      const expRaw = cells[idxExp] || '0';
      const experienceYears = Math.max(0, parseInt(String(expRaw).replace(/\D/g, '') || '0', 10) || 0);
      const verified =
        idxVerified >= 0 ? parseBool(cells[idxVerified] || 'true') : true;
      const aboutMe = idxAbout >= 0 ? (cells[idxAbout] || '').trim() : '';
      const profilePhotoUrl = idxPhoto >= 0 ? (cells[idxPhoto] || '').trim() : '';
      const description = idxDesc >= 0 ? (cells[idxDesc] || '').trim() : '';

      if (!phone || !name || !city) {
        errors.push(`שורה ${r + 1}: חסרים name / phone / city`);
        continue;
      }
      if (!VALID_PROFESSIONS.has(profession)) {
        errors.push(`שורה ${r + 1}: מקצוע לא חוקי "${profession}"`);
        continue;
      }

      const doc = {
        name,
        phone,
        profession: profession as 'plumber' | 'electrician' | 'ac' | 'painter' | 'handyman' | 'contractor',
        city,
        experienceYears,
        verified,
        aboutMe,
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        ...(description ? { description } : {}),
      };

      try {
        const existing = await Professional.findOne({ phone });
        if (existing) {
          await Professional.updateOne({ phone }, { $set: doc });
          updated++;
        } else {
          await Professional.create(doc);
          created++;
        }
      } catch (e) {
        errors.push(`שורה ${r + 1}: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      created,
      updated,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
