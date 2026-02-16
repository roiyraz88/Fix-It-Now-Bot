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
import { getPriceEstimation } from '@/services/openaiService';

// Format phone number: 97252... → 052...
function formatPhone(phone: string): string {
  if (!phone) return phone;
  // Remove 972 prefix and add 0
  if (phone.startsWith('972')) {
    return '0' + phone.slice(3);
  }
  return phone;
}

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

    // 2. Handle as a client (professionals can also be clients!)
    let state = await ConversationState.findOne({ phone });
    if (!state) {
      // Verified professionals: don't treat WhatsApp Business auto-greetings as new client
      const pro = await Professional.findOne({ phone, verified: true });
      if (pro) {
        await sendMessage(senderId, "היי! את/ה רשום/ה כבעל מקצוע במערכת. להגשת הצעה לעבודה, שלח את מספר העבודה (למשל: 31).");
        return NextResponse.json({ status: 'ok' });
      }
      state = await ConversationState.create({ 
        phone, 
        state: 'welcome', 
        accumulatedData: {} 
      });
      await sendMessage(senderId, WELCOME_MESSAGE);
      return NextResponse.json({ status: 'ok' });
    }

    // Only treat as idle pro if there's NO active client conversation
    // and they explicitly send a job number
    const pro = await Professional.findOne({ phone, verified: true });
    if (pro && state.state === 'welcome' && incomingText.match(/^#?\d+$/)) {
      // Pro trying to respond to a job with just a number
      const jobNum = parseInt(incomingText.replace('#', ''));
      const job = await Job.findOne({ shortId: jobNum });
      if (job) {
        let currentProState = proState || await ProfessionalState.create({ phone, step: 'idle' });
        await startProfessionalOfferFlow(senderId, job, currentProState);
        return NextResponse.json({ status: 'ok' });
      }
    }

    await handleClientFlow(state, senderId, incomingText, body);

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('ERROR IN WEBHOOK:', error);
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}

async function handleClientFlow(state: any, senderId: string, text: string, body: any) {
  console.log(`handleClientFlow - State: ${state.state}, Text: "${text}"`);
  
  // If waiting for offers
  if (state.state === 'waiting_for_offers') {
    await handleOfferSelection(state, senderId, text);
    return;
  }

  // If job was completed - ask if they need something else
  if (state.state === 'completed') {
    // Reset to welcome for a new request
    state.state = 'welcome';
    state.accumulatedData = {};
    await state.save();
    await sendMessage(senderId, "היי! שמח לשמוע ממך שוב 😊\nאיך אפשר לעזור לך הפעם?");
    return;
  }

  // RIGID STEP-BY-STEP FLOW WITH CONTEXT AWARENESS
  
  // Check for completely irrelevant messages (questions, random text)
  const isIrrelevant = /^(מה השעה|מי אתה|מה אתה|למה|איך|מתי|היי|שלום|הי|בוקר טוב|ערב טוב)\??$/i.test(text.trim());
  
  // Step 1: welcome - collect problem description
  if (state.state === 'welcome') {
    if (isIrrelevant || text.length < 3) {
      await sendMessage(senderId, "היי! 👋 אני כאן לעזור לך למצוא בעל מקצוע.\nספר לי מה הבעיה שלך? (למשל: יש לי נזילה בכיור)");
      return;
    }
    const problemType = detectProblemType(text);
    state.accumulatedData = { problemType, initialDescription: text };
    state.state = 'waiting_for_details';
    await state.save();
    await sendMessage(senderId, "קיבלתי. ספר לי עוד פרטים על הבעיה:");
    return;
  }

  // Step 2: waiting_for_details - collect more details (initialDescription stays from welcome)
  if (state.state === 'waiting_for_details') {
    if (isIrrelevant || text.length < 5) {
      await sendMessage(senderId, "אני צריך עוד קצת פרטים על הבעיה כדי למצוא לך בעל מקצוע מתאים.\nמה בדיוק קורה?");
      return;
    }
    state.accumulatedData.detailedDescription = text;
    state.state = 'waiting_for_photo';
    await state.save();
    await sendMessage(senderId, "יש לך תמונה של הבעיה? (שלח תמונה או כתוב 'לא')");
    return;
  }

  // Step 3: waiting_for_photo - collect photo or skip
  if (state.state === 'waiting_for_photo') {
    const isSkip = /^(לא|אין|דילוג|skip|no)$/i.test(text.trim());
    const isImage = body.messageData?.typeMessage === 'imageMessage';
    
    if (!isSkip && !isImage && text.length > 20) {
      // Might be more details, add them and ask again
      state.accumulatedData.detailedDescription += ' ' + text;
      await state.save();
      await sendMessage(senderId, "הוספתי את הפרטים. יש לך גם תמונה? (או כתוב 'לא')");
      return;
    }
    
    if (isImage) {
      state.accumulatedData.photoUrl = body.messageData.imageMessageData?.url;
    }
    state.state = 'waiting_for_city';
    await state.save();
    await sendMessage(senderId, "באיזו עיר אתה נמצא?");
    return;
  }

  // Step 4: waiting_for_city - collect city and finalize
  if (state.state === 'waiting_for_city') {
    // Check if it looks like a city name (short, Hebrew, no numbers)
    const cityText = text.trim();
    if (cityText.length < 2 || cityText.length > 30 || /\d/.test(cityText)) {
      await sendMessage(senderId, "לא הבנתי - באיזו עיר אתה נמצא? (למשל: תל אביב, חיפה, באר שבע)");
      return;
    }
    state.accumulatedData.city = cityText;
    state.accumulatedData.urgency = 'medium';
    await state.save();
    await finalizeJobCreation(state, senderId);
    return;
  }

  // Fallback - reset
  state.state = 'welcome';
  await state.save();
  await sendMessage(senderId, "מה הבעיה שלך?");
}

// Helper to detect problem type from text
function detectProblemType(text: string): string | null {
  // Handyman - check first because it's more general
  if (/(הרכבה|להרכיב|רהיט|רהיטים|איקאה|ikea|שולחן|ארון|מדף|מדפים|תיקון|תיקונים|לתקן|שבור|נשבר|הנדימן|תליה|לתלות|קיר גבס)/i.test(text)) {
    return 'handyman';
  }
  if (/(נזילה|נוזל|סתימה|סתום|צינור|אינסטלציה|אינסטלטור|ברז|כיור|אמבטיה|שירותים|ביוב|דוד|מים|אסלה|ניקוז)/i.test(text)) {
    return 'plumber';
  }
  if (/(חשמל|חשמלאי|קצר|שקע|תקע|נתיך|לוח חשמל|תאורה|מנורה|הארקה|נפל חשמל|קפץ)/i.test(text)) {
    return 'electrician';
  }
  if (/(מיזוג|מזגן|קירור|חימום|טכנאי מיזוג|לא מקרר|לא מחמם|מטפטף)/i.test(text)) {
    return 'ac';
  }
  if (/(צבע|צביעה|צבעי|קיר|קירות|לצבוע)/i.test(text)) {
    return 'painter';
  }
  if (/(שיפוץ|שיפוצים|קבלן|בנייה|ריצוף|גבס|טיח)/i.test(text)) {
    return 'contractor';
  }
  return 'handyman'; // Default to handyman for general requests
}

async function finalizeJobCreation(state: any, senderId: string) {
  // Get next shortId
  const counter = await Counter.findOneAndUpdate(
    { id: 'jobId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  console.log('Generated shortId:', counter.seq);

  // Get AI price estimation
  const priceEstimation = await getPriceEstimation(
    state.accumulatedData.problemType || 'plumber',
    state.accumulatedData.initialDescription || '',
    state.accumulatedData.detailedDescription || ''
  );

  const jobData = {
    shortId: counter.seq,
    clientPhone: state.phone,
    description: state.accumulatedData.initialDescription || '',
    detailedDescription: state.accumulatedData.detailedDescription || '',
    problemType: state.accumulatedData.problemType || 'plumber',
    city: state.accumulatedData.city,
    urgency: state.accumulatedData.urgency || 'medium',
    photoUrl: state.accumulatedData.photoUrl,
    status: 'searching_professionals'
  };

  const job = await Job.create(jobData);
  console.log('Job created with shortId:', job.shortId);

  state.state = 'waiting_for_offers';
  state.lastJobId = job._id;
  await state.save();

  let message = `תודה! יצרתי קריאה מספר #${job.shortId} 📝\n\n`;
  message += `*✨ הערכת מחיר על ידי AI:*\n`;
  message += `*₪${priceEstimation.min} - ₪${priceEstimation.max}*\n\n`;
  message += `${priceEstimation.explanation}\n\n`;
  message += `אני מחפש כעת אנשי מקצוע פנויים ב-${state.accumulatedData.city}. אשלח לך הצעות מחיר בקרוב.`;

  await sendMessage(senderId, message);
  await findAndNotifyProfessionals(job._id);
}

async function handleProfessionalStep(proState: any, senderId: string, text: string) {
  const pro = await Professional.findOne({ phone: proState.phone });

  if (proState.step === 'awaiting_price') {
    // Check if there are numbers in the text (minimal validation)
    const numbers = text.match(/\d+/g);
    
    if (!numbers || numbers.length === 0) {
      await sendMessage(senderId, "אנא שלח מחיר במספרים (למשל: 250 או 500-600).");
      return;
    }
    
    // Always keep the FULL text the professional wrote - pass it as-is to the client
    const priceText = text.trim();
    const priceValue = parseInt(numbers[0]); // For Offer model / sorting
    
    proState.accumulatedOffer.price = priceValue;
    proState.accumulatedOffer.priceText = priceText;
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
      
      const offerMsg = `✨ *הצעה חדשה לעבודה שלך!* ✨\n\n${proProfile}\n\n*מחיר:* ${proState.accumulatedOffer.priceText || proState.accumulatedOffer.price}\n*זמן הגעה:* ${proState.accumulatedOffer.eta}`;
      
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

  await sendMessage(senderId, `מעולה! ההצעה של ${pro.name} אושרה. ✅\nהנה המספר שלו: ${formatPhone(pro.phone)}.\nהוא יצור איתך קשר בהקדם.\n\n*אם תצטרך עזרה נוספת בעתיד, פשוט שלח הודעה!*`);
  
  const job = await Job.findById(state.lastJobId);
  if (job) {
    job.status = 'assigned';
    job.assignedProfessionalPhone = pro.phone;
    await job.save();
  }
  
  // Mark conversation as completed
  state.state = 'completed';
  state.completedJobId = state.lastJobId;
  await state.save();
  
  await sendMessage(`${pro.phone}@c.us`, `הלקוח אישר את הצעתך! 🎉\nהנה המספר שלו: ${formatPhone(state.phone)}. צור איתו קשר לתיאום סופי.`);
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
