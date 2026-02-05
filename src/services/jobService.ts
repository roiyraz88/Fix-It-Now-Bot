import Job from '@/models/Job';
import Professional from '@/models/Professional';
import ProfessionalState from '@/models/ProfessionalState';
import { sendMessage, sendButtons } from '@/lib/green-api';
import dbConnect from '@/lib/mongodb';

export async function findAndNotifyProfessionals(jobId: string) {
  await dbConnect();
  const job = await Job.findById(jobId);
  if (!job) return;

  console.log(`--- BROADCASTING NEW JOB #${job.shortId} ---`);
  
  const professionals = await Professional.find({ verified: true });
  console.log(`Found ${professionals.length} verified professionals to notify.`);

  let message = `🛠️ *עבודה חדשה זמינה! (#${job.shortId})*\n\n`;
  message += `*סוג עבודה:* ${job.problemType === 'plumber' ? 'אינסטלציה' : job.problemType === 'electrician' ? 'חשמל' : 'מיזוג אוויר'}\n`;
  message += `*תיאור:* ${job.description}\n`;
  if (job.detailedDescription && job.detailedDescription !== job.description) {
    message += `*פירוט נוסף:* ${job.detailedDescription}\n`;
  }
  message += `*עיר:* ${job.city || 'לא צוין'}\n`;
  
  if (job.photoUrl) {
    message += `\n*תמונה:* ${job.photoUrl}\n`;
  }

  message += `\n👇 לחץ על הכפתור למטה כדי להגיש הצעת מחיר`;

  const buttons = [
    { buttonId: `apply_job_${job.shortId}`, buttonText: 'הגש הצעת מחיר' }
  ];

  for (const pro of professionals) {
    const cleanPhone = pro.phone.replace(/\D/g, '');
    try {
      await sendButtons(
        cleanPhone, 
        message, 
        buttons, 
        'FixItNow - הצעת מחיר בלחיצת כפתור'
      );
      console.log(`Alert sent to ${pro.name} for job #${job.shortId} with button`);
    } catch (err) {
      console.error(`Failed to notify ${pro.name}:`, (err as Error).message);
      // Fallback to regular message if buttons fail
      await sendMessage(cleanPhone, message + `\n*כדי להגיש הצעה לעבודה זו השב את המספר ${job.shortId}*`);
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
