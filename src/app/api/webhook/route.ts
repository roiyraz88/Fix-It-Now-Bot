import { NextResponse } from 'next/server';
import { sendMessage, sendButtons, sendFileByUrl, sendInteractiveButtonsReply, sendContact } from '@/lib/green-api';
import dbConnect from '@/lib/mongodb';
import ConversationState from '@/models/ConversationState';
import ProfessionalState from '@/models/ProfessionalState';
import Job from '@/models/Job';
import Professional from '@/models/Professional';
import Offer from '@/models/Offer';
import Counter from '@/models/Counter';
import { findAndNotifyProfessionals, sendClientContactToProfessional } from '@/services/jobService';
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

const WELCOME_MESSAGE = "ברוך הבא! אני הבוט מבוסס ה-AI של FixItNow. 🛠️\nאיזה בעל מקצוע אוכל לעזור לכם למצוא?\n\n*טיפ:* ניתן לשלוח '9' בכל שלב כדי לאתחל את השיחה מחדש.";

const PROFESSION_LIST_MESSAGE = " 🛠️\nאיזה בעל מקצוע אוכל לעזור לכם למצוא?\n\n*טיפ:* ניתן לשלוח '9' בכל שלב כדי לאתחל את השיחה מחדש.";

const PROFESSION_MENU = `
איזה בעל מקצוע אוכל לעזור לכם למצוא?
1 - אינסטלטור 🔧
2 - חשמלאי ⚡
3 - הנדימן 🛠️
4 - צבעי 🎨

נא לשלוח את מספר בעל המקצוע הנדרש בלבד(אם אתם מעוניינים באינסטלטור שלחו את הספרה '1').

טיפ: ניתן לשלוח '9' בכל שלב כדי לאתחל את השיחה מחדש.`;

async function sendProfessionSelection(chatId: string) {
  await sendMessage(chatId, PROFESSION_MENU);
}

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
      const t = messageData.templateButtonsReplyMessageData || messageData.templateButtonReplyMessage;
      selectedButtonId = t?.selectedButtonId || t?.selectedId || '';
      incomingText = t?.selectedButtonText || t?.selectedDisplayText || '';
    } else if (messageData?.typeMessage === 'interactiveButtonsReply') {
      const ir = messageData.interactiveButtonsReply || messageData.interactiveButtonsReplyData;
      const btn = Array.isArray(ir?.buttons) ? ir.buttons.find((b: { buttonId?: string }) => b?.buttonId) : null;
      selectedButtonId = btn?.buttonId || ir?.selectedId || '';
      incomingText = btn?.buttonText || ir?.selectedDisplayText || '';
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
        state: 'choosing_profession', 
        accumulatedData: {} 
      });

      await sendProfessionSelection(senderId);
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
          console.log(`Professional ${pro.name} requested client contact for job #${shortId}`);
          await sendClientContactToProfessional(senderId, job);
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
      // Brand new user - show button menu (client vs professional)
      try {
        state = await ConversationState.create({ 
          phone, 
          state: 'choosing_role', 
          accumulatedData: {} 
        });
      } catch (e: unknown) {
        if ((e as { code?: number })?.code === 11000) return NextResponse.json({ status: 'ok' });
        throw e;
      }
      await sendInteractiveButtonsReply(
        senderId,
        'שלום! 👋 ברוך הבא ל-FixItNow. איך אוכל לעזור?',
        [
          { buttonId: 'role_client', buttonText: 'אני לקוח' },
          { buttonId: 'role_professional', buttonText: 'אני בעל מקצוע' },
        ],
        'FixItNow 🛠️',
        'בחר את הסוג שלך'
      );
      return NextResponse.json({ status: 'ok' });
    }

    // Handle role selection (first-time only)
    if (state.state === 'choosing_role') {
      const bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim().toLowerCase();
      if (bid === 'role_client' || txt.includes('לקוח') || txt === 'אני לקוח') {
        state.state = 'choosing_profession';
        await state.save();
        await sendProfessionSelection(senderId);
        return NextResponse.json({ status: 'ok' });
      }
      if (bid === 'role_professional' || txt.includes('בעל מקצוע') || txt === 'אני בעל מקצוע') {
        state.state = 'welcome';
        await state.save();
        await sendContact(senderId, {
          phoneContact: 972527345641,
          firstName: 'סער',
          lastName: 'ניב',
        });
        await sendMessage(senderId, "היי! 👷 אם אתה בעל מקצוע ומעוניין להירשם למערכת, צור קשר עם סער ניב.\nבנתיים, אפשר להשתמש בבוט כלקוח - ספר לי מה הבעיה שלך.");
        return NextResponse.json({ status: 'ok' });
      }
      // User sent something else - treat as client, send profession selection
      state.state = 'choosing_profession';
      await state.save();
      await sendProfessionSelection(senderId);
      return NextResponse.json({ status: 'ok' });
    }

    // Handle profession selection (client chose "אני לקוח")
    if (state.state === 'choosing_profession') {
      const profMap: Record<string, { problemType: string; desc: string }> = {
        prof_plumber: { problemType: 'plumber', desc: 'אינסטלטור' },
        prof_electrician: { problemType: 'electrician', desc: 'חשמלאי' },
        prof_handyman: { problemType: 'handyman', desc: 'הנדימן' },
        prof_painter: { problemType: 'painter', desc: 'צבעי' },
      };
      const numMap: Record<string, { problemType: string; desc: string }> = {
        '1': { problemType: 'plumber', desc: 'אינסטלטור' },
        '2': { problemType: 'electrician', desc: 'חשמלאי' },
        '3': { problemType: 'handyman', desc: 'הנדימן' },
        '4': { problemType: 'painter', desc: 'צבעי' },
      };
      const sel = (selectedButtonId || '').trim().toLowerCase();
      let prof = profMap[sel];
      if (!prof && incomingText) {
        const txt = incomingText.trim();
        prof = numMap[txt] ?? null;
        if (!prof) {
          if (/אינסטלטור/.test(txt)) prof = { problemType: 'plumber', desc: 'אינסטלטור' };
          else if (/חשמלאי/.test(txt)) prof = { problemType: 'electrician', desc: 'חשמלאי' };
          else if (/הנדימן/.test(txt)) prof = { problemType: 'handyman', desc: 'הנדימן' };
          else if (/צבעי/.test(txt)) prof = { problemType: 'painter', desc: 'צבעי' };
        }
      }
      if (prof) {
        state.accumulatedData = { problemType: prof.problemType, initialDescription: prof.desc };
        state.state = 'waiting_for_details';
        await state.save();
        await sendMessage(senderId, "אנא תאר/י במפורט מהי מטרת הפנייה:");
        return NextResponse.json({ status: 'ok' });
      }
      await sendProfessionSelection(senderId);
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
          await sendClientContactToProfessional(senderId, job);
        return NextResponse.json({ status: 'ok' });
      }
    }

    // Handle offer consent (Yes = notify professionals, No = skip)
    if (state.state === 'waiting_for_offer_consent') {
      const choice = (selectedButtonId || incomingText || '').trim().toLowerCase();
      const isYes = choice === 'consent_yes' || /כן/.test(choice);
      const isNo = choice === 'consent_no' || /^לא$/.test(choice);
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
      } else if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
      } else {
        await sendInteractiveButtonsReply(
          senderId,
          'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
          [
            { buttonId: 'consent_yes', buttonText: 'כן!' },
            { buttonId: 'consent_no', buttonText: 'לא' },
          ],
          'FixItNow 🛠️',
          'נא ללחוץ על כפתור'
        );
      }
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = cancel)
    if (state.state === 'waiting_for_offer_consent') {
      const bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim().toLowerCase();
      const isYes = bid === 'consent_yes' || txt === 'כן!' || txt === 'כן';
      const isNo = bid === 'consent_no' || txt === 'לא';
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        const job = await Job.findById(state.lastJobId);
        if (job) await findAndNotifyProfessionals(job._id);
      } else if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
      }
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = don't)
    if (state.state === 'waiting_for_offer_consent') {
      const bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim().toLowerCase();
      const isYes = bid === 'consent_yes' || txt === 'כן!' || txt === 'כן';
      const isNo = bid === 'consent_no' || txt === 'לא';
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      // Re-send consent question
      await sendInteractiveButtonsReply(
        senderId,
        'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
        [
          { buttonId: 'consent_yes', buttonText: 'כן!' },
          { buttonId: 'consent_no', buttonText: 'לא' },
        ],
        'FixItNow 🛠️',
        'בחר תשובה'
      );
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (after job creation - Yes = notify pros, No = skip)
    if (state.state === 'waiting_for_offer_consent') {
      const bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim().toLowerCase();
      const isYes = bid === 'consent_yes' || txt.includes('כן');
      const isNo = bid === 'consent_no' || (txt === 'לא' || txt === 'לא ');
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      await sendInteractiveButtonsReply(
        senderId,
        'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
        [
          { buttonId: 'consent_yes', buttonText: 'כן!' },
          { buttonId: 'consent_no', buttonText: 'לא' },
        ],
        'FixItNow 🛠️',
        'בחר תשובה'
      );
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (after job creation)
    if (state.state === 'waiting_for_offer_consent') {
      const bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim();
      const isYes = bid === 'consent_yes' || /כן|כן!/.test(txt);
      const isNo = bid === 'consent_no' || /^לא$/.test(txt);
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        if (state.lastJobId) {
          await findAndNotifyProfessionals(state.lastJobId.toString());
        }
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo) {
        if (state.lastJobId) {
          await Job.findByIdAndUpdate(state.lastJobId, { status: 'cancelled' });
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      await sendInteractiveButtonsReply(
        senderId,
        'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
        [
          { buttonId: 'consent_yes', buttonText: 'כן!' },
          { buttonId: 'consent_no', buttonText: 'לא' },
        ],
        'FixItNow 🛠️',
        'בחר תשובה'
      );
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = cancel)
    if (state.state === 'waiting_for_offer_consent') {
      const isYes = selectedButtonId === 'consent_yes' || /כן|yes/i.test(incomingText.trim());
      const isNo = selectedButtonId === 'consent_no' || /^לא$|^no$/i.test(incomingText.trim());
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
      } else if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
      } else {
        await sendInteractiveButtonsReply(
          senderId,
          'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
          [
            { buttonId: 'consent_yes', buttonText: 'כן!' },
            { buttonId: 'consent_no', buttonText: 'לא' },
          ],
          'FixItNow 🛠️',
          'בחר תשובה'
        );
      }
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = don't)
    if (state.state === 'waiting_for_offer_consent') {
      const bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim().toLowerCase();
      if (bid === 'consent_yes' || txt === 'כן!' || txt === 'כן') {
        state.state = 'waiting_for_offers';
        await state.save();
        const job = await Job.findById(state.lastJobId);
        if (job) await findAndNotifyProfessionals(job._id);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
      } else if (bid === 'consent_no' || txt === 'לא') {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
      } else {
        await sendInteractiveButtonsReply(
          senderId,
          'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
          [
            { buttonId: 'consent_yes', buttonText: 'כן!' },
            { buttonId: 'consent_no', buttonText: 'לא' },
          ],
          'FixItNow 🛠️',
          'נא לבחור כן או לא'
        );
      }
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = don't)
    if (state.state === 'waiting_for_offer_consent') {
      const isYes = selectedButtonId === 'consent_yes' || /כן|כן!/.test(incomingText.trim());
      const isNo = selectedButtonId === 'consent_no' || /^לא$/.test(incomingText.trim());
      if (isYes && state.lastJobId) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo && state.lastJobId) {
        await Job.findByIdAndUpdate(state.lastJobId, { status: 'cancelled' });
        state.state = 'completed';
        state.completedJobId = state.lastJobId;
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      await sendMessage(senderId, "אנא בחר 'כן!' או 'לא'.");
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (after job creation)
    if (state.state === 'waiting_for_offer_consent') {
      const consentYes = selectedButtonId === 'consent_yes' || /^\s*כן\!?\s*$/i.test(incomingText.trim());
      const consentNo = selectedButtonId === 'consent_no' || /^\s*לא\s*$/i.test(incomingText.trim());
      if (consentYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        await findAndNotifyProfessionals(state.lastJobId);
        return NextResponse.json({ status: 'ok' });
      }
      if (consentNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
    }

    // Handle offer consent (after job creation - notify pros only if client says Yes)
    if (state.state === 'waiting_for_offer_consent') {
      const choice = (selectedButtonId || incomingText || '').trim();
      const isYes = choice === 'consent_yes' || /כן|כן!|כן !/.test(choice);
      const isNo = choice === 'consent_no' || /^לא$/i.test(choice);
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      await sendMessage(senderId, "אנא בחר 'כן!' או 'לא'.");
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = don't)
    if (state.state === 'waiting_for_offer_consent') {
      const isYes = selectedButtonId === 'consent_yes' || /כן|yes/i.test(incomingText.trim());
      const isNo = selectedButtonId === 'consent_no' || /^לא$/i.test(incomingText.trim());
      if (isYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      await sendInteractiveButtonsReply(
        senderId,
        'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
        [
          { buttonId: 'consent_yes', buttonText: 'כן!' },
          { buttonId: 'consent_no', buttonText: 'לא' },
        ],
        'FixItNow 🛠️',
        'בחר תשובה'
      );
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = skip)
    if (state.state === 'waiting_for_offer_consent') {
      const saidYes = selectedButtonId === 'consent_yes' || /כן|כן!/.test(incomingText.trim());
      const saidNo = selectedButtonId === 'consent_no' || /^לא$/.test(incomingText.trim());
      if (saidYes) {
        state.state = 'waiting_for_offers';
        await state.save();
        await findAndNotifyProfessionals(state.lastJobId);
        await sendMessage(senderId, "התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!");
        return NextResponse.json({ status: 'ok' });
      }
      if (saidNo) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, "בסדר. אם תשנה את דעתך, פשוט שלח הודעה.");
        return NextResponse.json({ status: 'ok' });
      }
      await sendMessage(senderId, "נא ללחוץ על כן! או לא.");
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify pros, No = skip)
    if (state.state === 'waiting_for_offer_consent') {
      const isYes = selectedButtonId === 'consent_yes' || /^\s*כן!?\s*$/i.test(incomingText.trim());
      const isNo = selectedButtonId === 'consent_no' || /^\s*לא\s*$/i.test(incomingText.trim());
      if (isYes && state.lastJobId) {
        state.state = 'waiting_for_offers';
        await state.save();
        await sendMessage(senderId, 'התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!');
        await findAndNotifyProfessionals(state.lastJobId);
        return NextResponse.json({ status: 'ok' });
      }
      if (isNo && state.lastJobId) {
        const job = await Job.findById(state.lastJobId);
        if (job) {
          job.status = 'cancelled';
          await job.save();
        }
        state.state = 'completed';
        await state.save();
        await sendMessage(senderId, 'בסדר. אם תשנה את דעתך, פשוט שלח הודעה.');
        return NextResponse.json({ status: 'ok' });
      }
      await sendMessage(senderId, 'האם את/ה מעוניינ/ת בקבלת הצעות? (כן / לא)');
      return NextResponse.json({ status: 'ok' });
    }

    // Handle offer consent (Yes = notify professionals, No = skip)
    if (state.state === 'waiting_for_offer_consent') {
      const saidYes = selectedButtonId === 'consent_yes' || /כן/.test(incomingText);
      const saidNo = selectedButtonId === 'consent_no' || /^לא$/.test(incomingText.trim());
      if (saidYes && state.lastJobId) {
        state.state = 'waiting_for_offers';
        await state.save();
        await sendMessage(senderId, 'התחלתי בחיפושים אחר בעל מקצוע, בדקות הקרובות תקבל מגוון הצעות מבעלי מקצוע באזורך!');
        await findAndNotifyProfessionals(state.lastJobId);
        return NextResponse.json({ status: 'ok' });
      }
      if (saidNo && state.lastJobId) {
        await Job.findByIdAndUpdate(state.lastJobId, { status: 'cancelled' });
        state.state = 'completed';
        state.completedJobId = state.lastJobId;
        await state.save();
        await sendMessage(senderId, 'בסדר. אם תשנה את דעתך, פשוט שלח הודעה.');
        return NextResponse.json({ status: 'ok' });
      }
      await sendMessage(senderId, 'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע? (כן / לא)');
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
  console.log(`handleClientFlow - State: ${state.state}, Text: "${text}"`);
  
  // If waiting for offers - any message resets and starts new conversation as client
  if (state.state === 'waiting_for_offers') {
    await ConversationState.deleteOne({ phone: state.phone });
    await ConversationState.create({
      phone: state.phone,
      state: 'choosing_profession',
      accumulatedData: {},
    });
    await sendProfessionSelection(senderId);
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
        await sendMessage(senderId, "אנא תאר במפורט מהי מטרת הפנייה:");
    return;
  }

  // Step 2: waiting_for_details - collect more details (initialDescription stays from welcome)
  if (state.state === 'waiting_for_details') {
    if (isIrrelevant || text.length < 5) {
      await sendMessage(senderId, "אנא תאר במפורט מהי מטרת הפנייה:");
      return;
    }
    state.accumulatedData.detailedDescription = text;
    state.state = 'waiting_for_city';
    await state.save();
    await sendMessage(senderId, "באיזו עיר אתה נמצא?");
    return;
  }

  // Step 3: waiting_for_city - collect city and finalize
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

  state.state = 'waiting_for_offer_consent';
  state.lastJobId = job._id;
  await state.save();

  let message = `תודה! יצרתי קריאה מספר #${job.shortId} 📝\n\n`;
  message += `*✨ הערכת מחיר על ידי AI:*\n`;
  message += `*₪${priceEstimation.min} - ₪${priceEstimation.max}*\n\n`;
  message += `${priceEstimation.explanation}`;

  await sendMessage(senderId, message);
  await sendInteractiveButtonsReply(
    senderId,
    'האם את/ה מעוניינ/ת בקבלת הצעות מבעלי מקצוע באזורך?',
    [
      { buttonId: 'consent_yes', buttonText: 'כן!' },
      { buttonId: 'consent_no', buttonText: 'לא' },
    ],
    'FixItNow 🛠️',
    'בחר תשובה'
  );
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

  // Notify all other professionals who offered on this job that it's been closed
  if (job) {
    const otherOffers = await Offer.find({
      jobId: job._id,
      professionalPhone: { $ne: pro.phone }
    });

    const notifiedPhones = new Set<string>();
    for (const otherOffer of otherOffers) {
      if (!notifiedPhones.has(otherOffer.professionalPhone)) {
        notifiedPhones.add(otherOffer.professionalPhone);
        await sendMessage(
          `${otherOffer.professionalPhone}@c.us`,
          `עבודה מספר #${job.shortId} נסגרה ונלקחה על ידי בעל מקצוע אחר.\nתודה על ההצעה! 🙏`
        );
      }
    }
  }
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
