import { NextResponse } from 'next/server';
import { sendMessage, sendButtons } from '@/lib/green-api';
import dbConnect from '@/lib/mongodb';
import ConversationState from '@/models/ConversationState';
import ProfessionalState from '@/models/ProfessionalState';
import Job from '@/models/Job';
import Professional from '@/models/Professional';
import Offer from '@/models/Offer';
import Counter from '@/models/Counter';
import { analyzeClientMessage } from '@/services/openaiService';
import { findAndNotifyProfessionals, startProfessionalOfferFlow } from '@/services/jobService';

const WELCOME_MESSAGE = "ברוך הבא! אני הבוט מבוסס ה-AI של FixItNow. 🛠️\nבמה אוכל לעזור לך היום? (למשל: יש לי נזילה בכיור)\n\n*טיפ:* ניתן לשלוח '9' בכל שלב כדי לאתחל את השיחה מחדש.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.typeWebhook !== 'incomingMessageReceived') {
      return NextResponse.json({ status: 'ok' });
    }

    const senderId = body.senderData?.sender;
    const phone = senderId.split('@')[0];
    
    let incomingText = '';
    let selectedButtonId = '';

    if (body.messageData?.typeMessage === 'buttonsResponseMessage') {
      selectedButtonId = body.messageData.buttonsResponseMessageData?.selectedButtonId || '';
      incomingText = body.messageData.buttonsResponseMessageData?.selectedButtonText || '';
    } else {
      incomingText = body.messageData?.textMessageData?.textMessage || 
                     body.messageData?.extendedTextMessageData?.text || '';
    }

    await dbConnect();

    // 0. Handle reset logic
    if (incomingText.trim() === '9') {
      await ConversationState.deleteOne({ phone });
      await ProfessionalState.deleteOne({ phone });
      
      // Create fresh state so next message goes to 'welcome' handler
      await ConversationState.create({ 
        phone, 
        state: 'welcome', 
        accumulatedData: {} 
      });

      await sendMessage(senderId, WELCOME_MESSAGE);
      return NextResponse.json({ status: 'ok' });
    }

    // 1. Check if it's a professional starting a flow (via button or text)
    const proState = await ProfessionalState.findOne({ phone });

    if (selectedButtonId.startsWith('job_')) {
      const shortId = parseInt(selectedButtonId.replace('job_', ''));
      const job = await Job.findOne({ shortId });
      if (job) {
        const pro = await Professional.findOne({ phone, verified: true });
        if (pro) {
          let currentProState = proState || await ProfessionalState.create({ phone, step: 'idle' });
          await startProfessionalOfferFlow(senderId, job, currentProState);
          return NextResponse.json({ status: 'ok' });
        }
      }
    }

    // Handle button for accepting offer
    if (selectedButtonId.startsWith('accept_offer_')) {
      const offerId = selectedButtonId.replace('accept_offer_', '');
      const state = await ConversationState.findOne({ phone });
      if (state) {
        await handleOfferSelectionById(state, senderId, offerId);
        return NextResponse.json({ status: 'ok' });
      }
    }

    // Fallback for manual text entry
    if (/^\d+$/.test(incomingText.trim())) {
      const shortId = parseInt(incomingText.trim());
      const job = await Job.findOne({ shortId });
      if (job) {
        const pro = await Professional.findOne({ phone, verified: true });
        if (pro) {
          let currentProState = proState || await ProfessionalState.create({ phone, step: 'idle' });
          await startProfessionalOfferFlow(senderId, job, currentProState);
          return NextResponse.json({ status: 'ok' });
        }
      }
    }

    if (proState && proState.step !== 'idle') {
      await handleProfessionalStep(proState, senderId, incomingText);
      return NextResponse.json({ status: 'ok' });
    }

    // 2. Check if it's a registered pro but idle
    const pro = await Professional.findOne({ phone, verified: true });
    if (pro && (!proState || proState.step === 'idle')) {
      // If a pro sends something that isn't a number, just remind them
      await sendMessage(senderId, "היי! כדי להגיש הצעה לעבודה, אנא השב עם מספר העבודה (למשל: 101).");
      return NextResponse.json({ status: 'ok' });
    }

    // 3. Otherwise, handle as a client
    let state = await ConversationState.findOne({ phone });
    if (!state) {
      state = await ConversationState.create({ 
        phone, 
        state: 'welcome', 
        accumulatedData: {} 
      });
      await sendMessage(senderId, WELCOME_MESSAGE);
      return NextResponse.json({ status: 'ok' });
    }

    await handleClientFlow(state, senderId, incomingText, body);

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('ERROR IN WEBHOOK:', error);
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}

async function handleClientFlow(state: any, senderId: string, text: string, body: any) {
  switch (state.state) {
    case 'welcome':
      state.accumulatedData.initialProblem = text;
      state.state = 'waiting_for_details';
      await sendMessage(senderId, "תוכל לפרט קצת יותר על התקלה? (למשל: מתי זה התחיל, מה המצב כרגע וכו')");
      break;

    case 'waiting_for_details':
      state.accumulatedData.detailedDescription = text;
      const combinedText = `Problem: ${state.accumulatedData.initialProblem}\nDetails: ${state.accumulatedData.detailedDescription}`;
      const analysis = await analyzeClientMessage(combinedText);
      
      if (!analysis.isValid) {
        await sendMessage(senderId, `סליחה, התיאור עדיין לא מספיק ברור. 😕\n\n*הערה:* ${analysis.refusalReason || 'אנא פרט יותר.'}\n\nנסה לתאר שוב מה קרה.`);
        return;
      }

      state.accumulatedData = {
        ...state.accumulatedData,
        description: analysis.description,
        problemType: analysis.problemType,
        urgency: analysis.urgency,
        priceEstimation: analysis.priceEstimation,
        city: analysis.city || undefined
      };
      
      state.state = 'waiting_for_photo';
      await sendMessage(senderId, "אשמח אם תוכל לצרף תמונה של התקלה כדי שאוכל להבין טוב יותר (או שלח 'דילוג').");
      break;

    case 'waiting_for_photo':
      if (body.messageData?.typeMessage === 'imageMessage') {
        state.accumulatedData.photoUrl = body.messageData.imageMessageData?.url;
      }
      if (state.accumulatedData.city) {
        await finalizeJobCreation(state, senderId);
      } else {
        state.state = 'waiting_for_city';
        await sendMessage(senderId, "באיזו עיר אתה נמצא?");
      }
      break;

    case 'waiting_for_city':
      state.accumulatedData.city = text;
      await finalizeJobCreation(state, senderId);
      break;

    case 'waiting_for_offers':
      // The client now sends the name of the professional to accept an offer
      await handleOfferSelection(state, senderId, text);
      break;
  }
  await state.save();
}

async function finalizeJobCreation(state: any, senderId: string) {
  // Get next shortId
  const counter = await Counter.findOneAndUpdate(
    { id: 'jobId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  console.log('Generated shortId:', counter.seq);

  const jobData = {
    shortId: counter.seq,
    clientPhone: state.phone,
    description: state.accumulatedData.description,
    detailedDescription: state.accumulatedData.detailedDescription,
    problemType: state.accumulatedData.problemType,
    city: state.accumulatedData.city,
    urgency: state.accumulatedData.urgency,
    photoUrl: state.accumulatedData.photoUrl,
    status: 'searching_professionals'
  };

  const job = await Job.create(jobData);
  console.log('Job created with shortId:', job.shortId);

  state.state = 'waiting_for_offers';
  state.lastJobId = job._id;

  let welcomeBack = `תודה! יצרתי עבורך קריאה. 📝\n\n`;
  if (state.accumulatedData.priceEstimation) {
    const { min, max, explanation } = state.accumulatedData.priceEstimation;
    welcomeBack += `*✨ הערכת מחיר מומלצת על ידי AI:* \n`;
    welcomeBack += `*₪${max} - ₪${min}*\n\n`;
    welcomeBack += `${explanation}\n\n`;
  }
  welcomeBack += `אני מחפש כעת אנשי מקצוע פנויים ב-${state.accumulatedData.city}. אשלח לך הצעות מחיר בקרוב.`;
  
  await sendMessage(senderId, welcomeBack);
  await findAndNotifyProfessionals(job._id);
}

async function handleProfessionalStep(proState: any, senderId: string, text: string) {
  const pro = await Professional.findOne({ phone: proState.phone });

  if (proState.step === 'awaiting_price') {
    const price = parseInt(text.replace(/\D/g, ''));
    if (isNaN(price)) {
      await sendMessage(senderId, "אנא שלח מחיר במספרים בלבד (למשל: 250).");
      return;
    }
    proState.accumulatedOffer.price = price;
    proState.step = 'awaiting_eta';
    await proState.save();
    await sendMessage(senderId, "תוך כמה זמן תוכל להגיע ללקוח? (למשל: חצי שעה, שעתיים)");
  } 
  else if (proState.step === 'awaiting_eta') {
    proState.accumulatedOffer.eta = text;
    
    // Create final offer
    const offer = await Offer.create({
      jobId: proState.currentJobId,
      professionalPhone: proState.phone,
      price: proState.accumulatedOffer.price,
      eta: proState.accumulatedOffer.eta
    });

    // Notify client
    const job = await Job.findById(proState.currentJobId);
    if (job) {
      let proProfile = `*מציע:* ${pro.name}\n*ניסיון:* ${pro.experienceYears} שנים\n*דירוג:* מאומת ✓`;
      if (pro.aboutMe) {
        proProfile += `\n*קצת עלי:* ${pro.aboutMe}`;
      }
      
      const offerMsg = `✨ *קיבלתי הצעה חדשה עבור העבודה שלך!* ✨\n\n${proProfile}\n\n*מחיר:* ${proState.accumulatedOffer.price} ₪\n*זמן הגעה:* ${proState.accumulatedOffer.eta}`;
      
      const buttons = [
        { buttonId: `accept_offer_${offer._id}`, buttonText: 'אני בוחר בהצעה זו' }
      ];

      try {
        await sendButtons(`${job.clientPhone}@c.us`, offerMsg, buttons, 'לחץ על הכפתור לאישור ההצעה');
      } catch (err) {
        console.error('Failed to send buttons to client, falling back to text:', err);
        const fallbackMsg = offerMsg + `\n\nהאם תרצה לקבל את ההצעה? השב עם השם של בעל המקצוע: *${pro.name}*`;
        await sendMessage(`${job.clientPhone}@c.us`, fallbackMsg);
      }
    }

    await sendMessage(senderId, "ההצעה שלך נשלחה ללקוח! אעדכן אותך אם הוא יאשר.\nניתן להגיב לעבודות נוספות על ידי שליחת # והמספר.");

    proState.step = 'idle';
    proState.currentJobId = undefined;
    await proState.save();
  }
}

async function handleOfferSelectionById(state: any, senderId: string, offerId: string) {
  const offer = await Offer.findById(offerId);
  if (!offer) return;

  const pro = await Professional.findOne({ phone: offer.professionalPhone });
  if (!pro) return;

  await sendMessage(senderId, `מעולה! ההצעה של ${pro.name} אושרה. ✅\nהנה המספר שלו: ${pro.phone}.\nהוא יצור איתך קשר בהקדם.`);
  
  const job = await Job.findById(state.lastJobId);
  if (job) {
    job.status = 'assigned';
    job.assignedProfessionalPhone = pro.phone;
    await job.save();
  }
  
  await sendMessage(`${pro.phone}@c.us`, `הלקוח אישר את הצעתך! 🎉\nהנה המספר שלו: ${state.phone}. צור איתו קשר לתיאום סופי.`);
}

async function handleOfferSelection(state: any, senderId: string, choice: string) {
  // Choice is now expected to be the name of the professional
  const proName = choice.trim();
  if (!proName || proName.length < 2) return;
  
  // Find a professional with this name who has made an offer for this job
  const pro = await Professional.findOne({ name: new RegExp(`^${proName}$`, 'i') });
  
  if (pro) {
    const offer = await Offer.findOne({ 
      jobId: state.lastJobId, 
      professionalPhone: pro.phone 
    }).sort({ createdAt: -1 });

    if (offer) {
      await handleOfferSelectionById(state, senderId, offer._id);
    }
  }
}
