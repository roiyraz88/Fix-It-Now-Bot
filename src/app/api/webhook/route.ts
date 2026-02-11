import { NextResponse } from 'next/server';
import { sendMessage, sendButtons, sendFileByUrl } from '@/lib/green-api';
import dbConnect from '@/lib/mongodb';
import ConversationState from '@/models/ConversationState';
import ProfessionalState from '@/models/ProfessionalState';
import Job from '@/models/Job';
import Professional from '@/models/Professional';
import Offer from '@/models/Offer';
import Counter from '@/models/Counter';
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
    
    console.log(`--- Incoming Webhook from ${phone} ---`);
    console.log('Message Type:', body.messageData?.typeMessage);
    let incomingText = '';
    let selectedButtonId = '';

    // Improved button/list detection
    const messageData = body.messageData;
    if (messageData?.typeMessage === 'buttonsResponseMessage') {
      selectedButtonId = messageData.buttonsResponseMessageData?.selectedButtonId || '';
      incomingText = messageData.buttonsResponseMessageData?.selectedButtonText || '';
    } else if (messageData?.typeMessage === 'templateButtonsReplyMessage') {
      selectedButtonId = messageData.templateButtonsReplyMessageData?.selectedButtonId || '';
      incomingText = messageData.templateButtonsReplyMessageData?.selectedButtonText || '';
    } else if (messageData?.typeMessage === 'listResponseMessage') {
      selectedButtonId = messageData.listResponseMessageData?.rowId || '';
      incomingText = messageData.listResponseMessageData?.title || '';
    } else {
      incomingText = messageData?.textMessageData?.textMessage || 
                     messageData?.extendedTextMessageData?.text || '';
    }

    console.log(`Identified Text: "${incomingText}"`);
    console.log(`Selected Button ID: "${selectedButtonId}"`);

    await dbConnect();

    // 0. Handle reset logic
    if (incomingText.trim() === '9') {
      await ConversationState.deleteOne({ phone });
      await ProfessionalState.deleteOne({ phone });
      
      await ConversationState.create({ 
        phone, 
        state: 'welcome', 
        accumulatedData: {} 
      });

      await sendMessage(senderId, WELCOME_MESSAGE);
      return NextResponse.json({ status: 'ok' });
    }

    // 1. Check if it's a professional starting a flow
    const proState = await ProfessionalState.findOne({ phone });

    // Identify job ID from button or text
    let jobIdFromMessage = '';
    if (selectedButtonId.startsWith('apply_job_')) {
      jobIdFromMessage = selectedButtonId.replace('apply_job_', '');
    } else if (selectedButtonId.startsWith('job_')) {
      jobIdFromMessage = selectedButtonId.replace('job_', '');
    } else if (selectedButtonId.startsWith('accept_offer_')) {
      // Handle client side
    } else {
      // Try to find a number in the text (like "7" or "תיתן הצעת מחיר (#7)")
      const match = incomingText.match(/#(\d+)/) || incomingText.match(/^(\d+)$/);
      if (match) {
        jobIdFromMessage = match[1];
      }
    }

    if (jobIdFromMessage) {
      const shortId = parseInt(jobIdFromMessage);
      const job = await Job.findOne({ shortId });
      if (job) {
        const pro = await Professional.findOne({ phone, verified: true });
        if (pro) {
          console.log(`Professional ${pro.name} starting flow for job #${shortId}`);
          let currentProState = proState || await ProfessionalState.create({ phone, step: 'idle' });
          await startProfessionalOfferFlow(senderId, job, currentProState);
          return NextResponse.json({ status: 'ok' });
        }
      }
    }

    // Handle button for accepting offer (Client side)
    if (selectedButtonId.startsWith('accept_offer_')) {
      const offerId = selectedButtonId.replace('accept_offer_', '');
      const state = await ConversationState.findOne({ phone });
      if (state) {
        await handleOfferSelectionById(state, senderId, offerId);
        return NextResponse.json({ status: 'ok' });
      }
    }

    if (proState && proState.step !== 'idle') {
      await handleProfessionalStep(proState, senderId, incomingText);
      return NextResponse.json({ status: 'ok' });
    }

    // 2. Check if it's a registered pro but idle (and NOT a button/job response)
    const pro = await Professional.findOne({ phone, verified: true });
    if (pro && (!proState || proState.step === 'idle')) {
      // If a pro sends "תיתן הצעת מחיר" as text (sometimes buttons fall back to text)
      if (incomingText.includes('הצעת מחיר')) {
        // We already tried to find the job ID above, if we are here, it failed.
        await sendMessage(senderId, "לא הצלחתי לזהות את מספר העבודה. אנא השב עם המספר בלבד (למשל: 7).");
      } else {
        await sendMessage(senderId, "היי! כדי להגיש הצעה לעבודה, אנא השב עם מספר העבודה (למשל: 101).");
      }
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
  // If we are in the middle of a job search (waiting for offers)
  if (state.state === 'waiting_for_offers') {
    await handleOfferSelection(state, senderId, text);
    return;
  }

  // STEP-BY-STEP STRUCTURED FLOW (no AI per step - faster & more predictable)
  
  // Step 1: welcome -> waiting_for_problem (ask what the issue is)
  if (state.state === 'welcome') {
    // Detect problem type from first message
    const problemType = detectProblemType(text);
    if (problemType) {
      state.accumulatedData = { ...state.accumulatedData, problemType, initialDescription: text };
      state.state = 'waiting_for_details';
      await state.save();
      await sendMessage(senderId, `הבנתי, בעיה ב${getProblemName(problemType)}. 🔧\nספר לי עוד קצת פרטים - מה בדיוק קורה? (ככל שתפרט יותר, כך נוכל לעזור טוב יותר)`);
    } else {
      // Can't detect, ask more clearly
      await sendMessage(senderId, "לא הצלחתי להבין את סוג הבעיה. 🤔\nהאם מדובר בבעיית *אינסטלציה* (נזילה, סתימה), *חשמל* או *מיזוג אוויר*?");
    }
    return;
  }

  // Step 2: waiting_for_details -> waiting_for_photo
  if (state.state === 'waiting_for_details') {
    state.accumulatedData.detailedDescription = text;
    state.accumulatedData.description = `${state.accumulatedData.initialDescription || ''} - ${text}`;
    state.state = 'waiting_for_photo';
    await state.save();
    await sendMessage(senderId, "תודה על הפרטים! 📝\nיש לך תמונה של התקלה? זה יעזור לבעלי המקצוע להבין טוב יותר.\n(שלח תמונה או כתוב 'דילוג')");
    return;
  }

  // Step 3: waiting_for_photo -> waiting_for_city
  if (state.state === 'waiting_for_photo') {
    if (body.messageData?.typeMessage === 'imageMessage') {
      state.accumulatedData.photoUrl = body.messageData.imageMessageData?.url;
      await sendMessage(senderId, "קיבלתי את התמונה! 📸");
    } else if (!text.includes('דילוג') && text.length > 10) {
      // User might be adding more details instead of photo
      state.accumulatedData.detailedDescription += ` ${text}`;
      await sendMessage(senderId, "הבנתי, הוספתי לפרטים. 👍\nעכשיו - יש לך תמונה? (או כתוב 'דילוג')");
      await state.save();
      return;
    }
    // Move to city step
    state.state = 'waiting_for_city';
    await state.save();
    await sendMessage(senderId, "באיזו עיר אתה נמצא? 🏙️");
    return;
  }

  // Step 4: waiting_for_city -> finalize
  if (state.state === 'waiting_for_city') {
    const city = text.trim();
    if (city.length < 2) {
      await sendMessage(senderId, "אנא ציין שם עיר תקין.");
      return;
    }
    state.accumulatedData.city = city;
    state.accumulatedData.urgency = 'medium'; // default urgency
    await state.save();
    await finalizeJobCreation(state, senderId);
    return;
  }

  // Fallback: If state is unknown, reset to welcome
  state.state = 'welcome';
  await state.save();
  await sendMessage(senderId, "משהו השתבש. בוא נתחיל מחדש - מה הבעיה שאתה צריך עזרה בה?");
}

// Helper to detect problem type from text
function detectProblemType(text: string): 'plumber' | 'electrician' | 'ac' | null {
  const lower = text.toLowerCase();
  
  // Plumber keywords
  if (/(נזילה|סתימה|צינור|אינסטלציה|אינסטלטור|ברז|כיור|אמבטיה|שירותים|ביוב|דוד|מים)/i.test(text)) {
    return 'plumber';
  }
  
  // Electrician keywords
  if (/(חשמל|חשמלאי|קצר|שקע|תקע|נתיך|לוח חשמל|תאורה|מנורה|הארקה)/i.test(text)) {
    return 'electrician';
  }
  
  // AC keywords
  if (/(מיזוג|מזגן|קירור|חימום|טכנאי מיזוג)/i.test(text)) {
    return 'ac';
  }
  
  return null;
}

// Helper to get Hebrew name for problem type
function getProblemName(type: string): string {
  switch (type) {
    case 'plumber': return 'אינסטלציה';
    case 'electrician': return 'חשמל';
    case 'ac': return 'מיזוג אוויר';
    default: return 'בית';
  }
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
    detailedDescription: state.accumulatedData.detailedDescription || state.accumulatedData.description,
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
      
      const offerMsg = `✨ *הצעה חדשה לעבודה שלך!* ✨\n\n${proProfile}\n\n*מחיר:* ${proState.accumulatedOffer.price} ₪\n*זמן הגעה:* ${proState.accumulatedOffer.eta}`;
      
      // Send profile photo if available
      if (pro.profilePhotoUrl) {
        try {
          await sendFileByUrl(
            `${job.clientPhone}@c.us`,
            pro.profilePhotoUrl,
            `📸 ${pro.name} - בעל מקצוע מאומת`
          );
        } catch (photoErr) {
          console.error('Failed to send profile photo:', (photoErr as Error).message);
        }
      }
      
      // Ensure button text is under 25 chars
      const buttonText = `בחר בהצעה של ${pro.name}`.substring(0, 25);
      
      const buttons = [
        { buttonId: `accept_offer_${offer._id}`, buttonText }
      ];

      try {
        await sendButtons(
          `${job.clientPhone}@c.us`, 
          offerMsg, 
          buttons, 
          'לחץ על הכפתור לאישור'
        );
      } catch (err) {
        console.error('Failed to send buttons to client:', (err as Error).message);
        const fallbackMsg = offerMsg + `\n\n*לאישור ההצעה השב:* ${pro.name}`;
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
  // Clean the choice text if it comes from the button "בחר בהצעה של רועי רז"
  let proName = choice.replace('בחר בהצעה של ', '').trim();
  
  if (!proName || proName.length < 2) return;
  
  // Find a professional with this name
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
