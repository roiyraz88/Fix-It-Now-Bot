import Job from '@/models/Job';
import Professional from '@/models/Professional';
import ProfessionalState from '@/models/ProfessionalState';
import { sendMessage, sendListMessage } from '@/lib/green-api';
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
  message += `*עיר:* ${job.city || 'לא צוין'}\n`;
  
  if (job.photoUrl) {
    message += `\n📷 *תמונה מצורפת*\n`;
  }

  message += `\n*להגשת הצעה - השב עם המספר ${job.shortId}*`;

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

export async function startProfessionalOfferFlow(senderId: string, job: any, proState: any) {
  proState.currentJobId = job._id;
  proState.step = 'awaiting_price';
  proState.accumulatedOffer = {};
  await proState.save();

  await sendMessage(senderId, `מתחילים הצעה עבור עבודה #${job.shortId}.\nמה הצעת המחיר שלך? (בשקלים)`);
}
