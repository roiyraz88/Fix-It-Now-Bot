import Job from '@/models/Job';
import Professional from '@/models/Professional';
import ProfessionalState from '@/models/ProfessionalState';
import { sendMessage, sendContact, getContactInfo } from '@/lib/green-api';
import dbConnect from '@/lib/mongodb';

const getProfessionName = (type: string): string => {
  const names: Record<string, string> = {
    plumber: 'אינסטלציה',
    electrician: 'חשמל',
    ac: 'מיזוג אוויר',
    painter: 'צביעה',
    handyman: 'הנדימן',
    contractor: 'שיפוצים'
  };
  return names[type] || type;
};

export async function findAndNotifyProfessionals(jobId: string) {
  await dbConnect();
  const job = await Job.findById(jobId);
  if (!job) return;

  console.log(`--- BROADCASTING NEW JOB #${job.shortId} ---`);

  const professionals = await Professional.find({ verified: true });
  console.log(`Found ${professionals.length} verified professionals to notify.`);

  let message = `🛠️ *עבודה חדשה זמינה! (#${job.shortId})*\n\n`;
  message += `*סוג עבודה:* ${getProfessionName(job.problemType)}\n`;
  message += `*תיאור העבודה:* ${job.description || 'לא צוין'}\n`;
  if (job.detailedDescription) {
    message += `*פירוט:* ${job.detailedDescription}\n`;
  }
  message += `*עיר:* ${job.city || 'לא צוין'}\n\n`;
  message += `לקבלת הטלפון של הלקוח השב עם המספר ${job.shortId}`;

  for (const pro of professionals) {
    const cleanPhone = pro.phone.replace(/\D/g, '');
    try {
      await sendMessage(cleanPhone, message);
      console.log(`Alert sent to ${pro.name} for job #${job.shortId}`);
    } catch (err) {
      console.error(`Failed to notify ${pro.name}:`, (err as Error).message);
    }
  }
}

function formatPhoneForDisplay(phone: string): string {
  if (!phone) return phone;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('972')) return '0' + cleaned.slice(3);
  return cleaned.startsWith('0') ? cleaned : '0' + cleaned;
}

/** Convert to intl format for sendContact: 972521234567 */
function toIntlPhone(phone: string): number {
  const cleaned = (phone || '').replace(/\D/g, '');
  if (cleaned.startsWith('972')) return parseInt(cleaned, 10);
  if (cleaned.startsWith('0')) return parseInt('972' + cleaned.slice(1), 10);
  return parseInt('972' + cleaned, 10);
}

/** Send client contact to professional - only number + name */
export async function sendClientContactToProfessional(professionalChatId: string, job: any) {
  const clientPhone = job.clientPhone || '';
  if (!clientPhone) {
    await sendMessage(professionalChatId, `אין פרטי לקוח שמורים לעבודה #${job.shortId}.`);
    return;
  }
  let clientName = 'לקוח';
  const cleaned = (clientPhone || '').replace(/\D/g, '');
  const intlNum = cleaned.startsWith('972') ? cleaned : cleaned.startsWith('0') ? '972' + cleaned.slice(1) : '972' + cleaned;
  const clientChatId = clientPhone.includes('@') ? clientPhone : `${intlNum}@c.us`;
  try {
    const info = await getContactInfo(clientChatId);
    clientName = (info.contactName || info.name || '').trim() || 'לקוח';
  } catch (e) {
    console.error('getContactInfo failed:', (e as Error).message);
  }
  const displayPhone = formatPhoneForDisplay(clientPhone);
  try {
    await sendContact(professionalChatId, {
      phoneContact: toIntlPhone(clientPhone),
      firstName: clientName,
      lastName: `#${job.shortId}`,
    });
    await sendMessage(professionalChatId, `${clientName} - ${displayPhone}`);
  } catch (err) {
    console.error('sendContact failed, fallback to text:', (err as Error).message);
    await sendMessage(professionalChatId, `${clientName}: ${displayPhone}`);
  }
}
