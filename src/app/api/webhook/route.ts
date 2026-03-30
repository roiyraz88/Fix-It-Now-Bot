import { NextResponse } from 'next/server';
import { sendMessage, sendButtons, sendFileByUrl, sendInteractiveButtonsReply, sendContact } from '@/lib/green-api';
import dbConnect from '@/lib/mongodb';
import ConversationState from '@/models/ConversationState';
import ProfessionalState from '@/models/ProfessionalState';
import Job from '@/models/Job';
import type { IJob } from '@/models/Job';
import Professional from '@/models/Professional';
import Offer from '@/models/Offer';
import Counter from '@/models/Counter';
import ProcessedMessage from '@/models/ProcessedMessage';
import {
  findAndNotifyProfessionals,
  sendClientContactToProfessional,
  notifyProfessionalsJobStillOpen,
  notifyProfessionalsJobFilledByClient,
  phonesMatch,
} from '@/services/jobService';
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

const PROFESSION_MENU = 
`איזה בעל מקצוע אוכל לעזור לכם למצוא?
1 - אינסטלטור 🔧
2 - חשמלאי ⚡
3 - הנדימן 🛠️
4 - צבעי 🎨

נא לשלוח את מספר בעל המקצוע הנדרש בלבד(אם אתם מעוניינים באינסטלטור שלחו את הספרה '1').

טיפ: ניתן לשלוח '9' בכל שלב כדי לאתחל את השיחה מחדש.`;

const PROFESSION_MENU_COOLDOWN_MS = 10 * 60 * 1000;

async function sendProfessionSelection(chatId: string) {
  await sendMessage(chatId, PROFESSION_MENU);
}

/** Avoids sending the profession menu twice within 10 minutes (duplicate webhooks / rapid re-entry). Persists lastProfessionMenuSentAt. */
async function sendProfessionSelectionUnlessCooldown(senderId: string, state: { phone: string; lastProfessionMenuSentAt?: Date | null; save: () => Promise<unknown> }) {
  const now = Date.now();
  const last = state.lastProfessionMenuSentAt ? new Date(state.lastProfessionMenuSentAt).getTime() : 0;
  if (last && now - last < PROFESSION_MENU_COOLDOWN_MS) {
    console.log(
      `[profession menu] skipped cooldown (${Math.round((now - last) / 1000)}s since last) phone=${state.phone}`
    );
    return;
  }
  await sendProfessionSelection(senderId);
  state.lastProfessionMenuSentAt = new Date();
  await state.save();
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
    } else if (messageData?.typeMessage === 'interactiveButtonsReply' || messageData?.typeMessage === 'interactiveButtonReply') {
      const ir = messageData.interactiveButtonsReply || messageData.interactiveButtonsReplyData || messageData.interactiveButtonReply || {};
      selectedButtonId = ir?.selectedId || ir?.selectedButtonId || (messageData as any)?.selectedId || '';
      incomingText = ir?.selectedDisplayText || ir?.selectedButtonText || ir?.selectedButtonText || '';
      if (!selectedButtonId && Array.isArray(ir?.buttons)) {
        const idx = (ir as any).selectedIndex;
        const sel = typeof idx === 'number' ? ir.buttons[idx] : ir.buttons.find((b: any) => b.selected) || ir.buttons[0];
        if (sel) {
          selectedButtonId = sel.buttonId || selectedButtonId;
          incomingText = sel.buttonText || incomingText;
        }
      }
    }
    // Fallback: deep search for selectedId (Green API format varies)
    if (!selectedButtonId && messageData) {
      const anyData = messageData as Record<string, unknown>;
      const sel = anyData?.selectedId || (anyData?.templateButtonReplyMessage as any)?.selectedId || (anyData?.templateButtonsReplyMessageData as any)?.selectedId;
      if (sel) selectedButtonId = String(sel);
      const txt = anyData?.selectedDisplayText || (anyData?.templateButtonReplyMessage as any)?.selectedDisplayText || (anyData?.templateButtonsReplyMessageData as any)?.selectedDisplayText;
      if (txt) incomingText = String(txt);
    } else if (messageData?.typeMessage === 'listResponseMessage') {
      selectedButtonId = messageData.listResponseMessageData?.rowId || '';
      incomingText = messageData.listResponseMessageData?.title || '';
    } else {
      incomingText = messageData?.textMessageData?.textMessage || 
                     messageData?.extendedTextMessageData?.text || 
                     (messageData?.typeMessage === 'quotedMessage' && (messageData as any)?.quotedMessage?.textMessage) || '';
    }

    // Fallback: Green API may nest button response - scan for selectedId/selectedDisplayText
    const btnTypes = ['templateButtonsReplyMessage', 'templateButtonReplyMessage', 'interactiveButtonsReply', 'interactiveButtonReply', 'buttonsResponseMessage'];
    const typeMsg = String(messageData?.typeMessage || '');
    if ((!selectedButtonId || !incomingText) && (messageData || body)) {
      const found: { id?: string; text?: string } = {};
      const scan = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        const obj = o as Record<string, unknown>;
        if (obj.selectedId !== undefined) found.id = String(obj.selectedId);
        if (obj.selectedButtonId && typeof obj.selectedButtonId === 'string') found.id = obj.selectedButtonId;
        if ((obj.selectedDisplayText || obj.selectedButtonText) && typeof (obj.selectedDisplayText || obj.selectedButtonText) === 'string') {
          found.text = String(obj.selectedDisplayText || obj.selectedButtonText);
        }
        if (typeof obj.textMessage === 'string') found.text = obj.textMessage;
        if (typeof obj.text === 'string') found.text = (found.text || obj.text) as string;
        Object.values(obj).forEach(scan);
      };
      scan(messageData);
      scan(body);
      if (found.id && !selectedButtonId) selectedButtonId = found.id;
      if (found.text && !incomingText) incomingText = found.text;
    }

    // Fallback: deep scan for job number (e.g. "74") - Green API format can vary
    const scanForNum = (o: unknown): string => {
      if (!o || typeof o !== 'object') return '';
      const obj = o as Record<string, unknown>;
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && /^#?\d+$/.test(v.trim())) return v.trim();
        const r = scanForNum(v);
        if (r) return r;
      }
      return '';
    };
    const numFromBody = scanForNum(body);
    if (numFromBody && (!incomingText || !incomingText.trim())) incomingText = numFromBody;

    console.log(`Identified Text: "${incomingText}" SelectedButtonId: "${selectedButtonId}" type: ${messageData?.typeMessage}`);

    await dbConnect();

    // Idempotency: prevent duplicate webhook processing (Green API may send same message twice)
    const idMessage = body.idMessage;
    if (idMessage) {
      try {
        await ProcessedMessage.create({ idMessage });
      } catch (e: unknown) {
        if ((e as { code?: number })?.code === 11000) {
          console.log(`[Idempotency] Skipping duplicate message ${idMessage}`);
          return NextResponse.json({ status: 'ok' });
        }
        throw e;
      }
    }

    // 0. Handle reset logic
    if (incomingText.trim() === '9') {
      await ConversationState.deleteOne({ phone });
      await ProfessionalState.deleteOne({ phone });
      
      const resetState = await ConversationState.create({
        phone,
        state: 'choosing_profession',
        accumulatedData: {},
      });
      await sendProfessionSelectionUnlessCooldown(senderId, resetState);
      return NextResponse.json({ status: 'ok' });
    }

    // 0b. Client follow-up (~30min, one-time): more offers yes / stop (incl. legacy 2-button flow)
    const stateEarly = await ConversationState.findOne({ phone });
    const bidFollow = (selectedButtonId || '').trim();
    const followYes = bidFollow.match(/^follow_more_yes_(\d+)$/);
    const followNo =
      bidFollow.match(/^follow_more_no_(\d+)$/) ||
      bidFollow.match(/^follow_more_closed_pro_(\d+)$/) ||
      bidFollow.match(/^follow_more_stop_offers_(\d+)$/);
    let jobFollow: IJob | null = null;
    let clientWantsMore: boolean | null = null;
    if (followYes || followNo) {
      const sid = parseInt((followYes || followNo)![1], 10);
      const j = await Job.findOne({ shortId: sid });
      if (j?.clientFollowUpSent && phonesMatch(phone, j.clientPhone)) {
        jobFollow = j;
        clientWantsMore = !!followYes;
      }
    } else if (
      (bidFollow === '0' || bidFollow === '1' || bidFollow === '2') &&
      stateEarly?.lastJobId
    ) {
      jobFollow = await Job.findById(stateEarly.lastJobId);
      if (jobFollow?.clientFollowUpSent && phonesMatch(phone, jobFollow.clientPhone)) {
        // Order: 0/1 = stop offers, 2 = more offers (matches 3-button follow-up)
        clientWantsMore = bidFollow === '2';
      } else {
        jobFollow = null;
      }
    }
    if (jobFollow && clientWantsMore !== null) {
      if (clientWantsMore) {
        await sendMessage(
          senderId,
          'אין בעיה, אנחנו מיד מפנים אליך בעלי מקצוע נוספים! 🛠️'
        );
        await notifyProfessionalsJobStillOpen(jobFollow._id.toString());
      } else {
        jobFollow.acceptingMorePros = false;
        jobFollow.status = 'completed';
        await jobFollow.save();
        await sendMessage(
          senderId,
          'מקווים שעזרנו לך – נשמח לראות אותך שוב בפעם הבאה! 👋'
        );
        await notifyProfessionalsJobFilledByClient(jobFollow._id.toString());
      }
      return NextResponse.json({ status: 'ok' });
    }

    // 1. Job number reply - HIGHEST PRIORITY: professional replied with job # to get client contact
    let rawText = (incomingText || '').trim();
    // Fallback: if empty, deep-scan body for "74" etc (Green API format can vary)
    if (!rawText) {
      const scanForNum = (o: unknown): string => {
        if (!o || typeof o !== 'object') return '';
        const obj = o as Record<string, unknown>;
        for (const v of Object.values(obj)) {
          if (typeof v === 'string' && /^#?\d+$/.test(v.trim())) return v.trim();
          const r = scanForNum(v);
          if (r) return r;
        }
        return '';
      };
      rawText = scanForNum(body);
    }
    const stateForOrder = await ConversationState.findOne({ phone });
    const isChoosingProfession = stateForOrder?.state === 'choosing_profession';
    const textLooksLikeProfessionNum = /^[1-4]$/.test(rawText);

    let jobIdFromMessage = '';
    if (selectedButtonId?.startsWith('apply_job_')) {
      jobIdFromMessage = selectedButtonId.replace('apply_job_', '');
    } else if (selectedButtonId?.startsWith('job_')) {
      jobIdFromMessage = selectedButtonId.replace('job_', '');
    } else if (!textLooksLikeProfessionNum) {
      const match = rawText.match(/#(\d+)/) || rawText.match(/^(\d+)$/);
      if (match) jobIdFromMessage = match[1];
    }

    if (jobIdFromMessage) {
      const shortId = parseInt(jobIdFromMessage, 10);
      const job = await Job.findOne({ $or: [{ shortId }, { shortId: jobIdFromMessage }] });
      if (job) {
        console.log(`[Job] Sending client contact for job #${shortId} to ${phone}`);
        await ProfessionalState.findOneAndUpdate(
          { phone },
          { step: 'idle', currentJobId: undefined },
          { upsert: false }
        );
        await sendClientContactToProfessional(senderId, job);
        return NextResponse.json({ status: 'ok' });
      }
      console.log(`[Job] No job found for shortId ${shortId} (rawText="${rawText}") - check DB`);
    }

    // Verified professional who didn't send job number - no client flow, no menus
    const phoneAlt = phone.startsWith('972') ? '0' + phone.slice(3) : (phone.startsWith('0') ? '972' + phone.slice(1) : phone);
    const isVerifiedPro = await Professional.findOne({ $or: [{ phone, verified: true }, { phone: phoneAlt, verified: true }] });
    if (isVerifiedPro) {
      return NextResponse.json({ status: 'ok' });
    }

    // 2. Professional flow
    const proState = await ProfessionalState.findOne({ phone });

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

    // 3. Handle as a client (professionals can also be clients!)
    let state = await ConversationState.findOne({ phone });
    if (!state) {
      // Verified professionals with no state: last-chance check for job number (in case main block missed it)
      const phoneAlt = phone.startsWith('972') ? '0' + phone.slice(3) : (phone.startsWith('0') ? '972' + phone.slice(1) : phone);
      const pro = await Professional.findOne({ $or: [{ phone, verified: true }, { phone: phoneAlt, verified: true }] });
      if (pro) {
        const jobNumMatch = rawText.match(/^#?(\d+)$/) && !/^[1-4]$/.test((rawText.match(/^#?(\d+)$/) || [])[1] || '');
        if (jobNumMatch) {
          const num = parseInt((rawText.match(/^#?(\d+)$/) || [])[1] || '0', 10);
          const job = await Job.findOne({ shortId: num });
          if (job) {
            await sendClientContactToProfessional(senderId, job);
            return NextResponse.json({ status: 'ok' });
          }
        }
        // Pro sent something else - no need to prompt, just return
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
      let bid = (selectedButtonId || '').trim().toLowerCase();
      const txt = (incomingText || '').trim().toLowerCase();
      // Green API may send "0"/"1" as button index - map to our ids
      if (bid === '0') bid = 'role_client';
      if (bid === '1') bid = 'role_professional';
      if (bid === 'role_client' || txt.includes('לקוח') || txt === 'אני לקוח') {
        state.state = 'choosing_profession';
        await state.save();
        await sendProfessionSelectionUnlessCooldown(senderId, state);
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
      await sendProfessionSelectionUnlessCooldown(senderId, state);
      return NextResponse.json({ status: 'ok' });
    }

    // Handle profession selection (client chose "אני לקוח") - MUST be before waiting_for_details
    if (state.state === 'choosing_profession') {
      // Use raw text - scan/other logic might overwrite incomingText (Green API format varies)
      const rawText = (messageData?.textMessageData?.textMessage || messageData?.extendedTextMessageData?.text || incomingText || '').trim();
      const txt = (rawText || incomingText || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      console.log(`[choosing_profession] rawText="${rawText}" txt="${txt}" sel="${selectedButtonId}"`);
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
      if (!prof) {
        prof = numMap[sel] ?? numMap[txt] ?? numMap[rawText] ?? null;
        if (!prof) {
          const parsed = parseInt(txt, 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) prof = numMap[String(parsed)];
        }
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
      console.log(`[choosing_profession] No match - rawText="${rawText}" txt="${txt}" sel="${sel}" incomingText="${incomingText}"`);
      await sendProfessionSelectionUnlessCooldown(senderId, state);
      return NextResponse.json({ status: 'ok' });
    }

    // Handle waiting_for_details - explicit handler to avoid loop, advance to city
    if (state.state === 'waiting_for_details') {
      const md = body?.messageData || {};
      const raw = (incomingText || '').trim() || md.textMessageData?.textMessage || md.extendedTextMessageData?.text || '';
      // Deep fallback: scan for text in nested structures (quotedMessage, etc.)
      let detailText = (raw || '').trim();
      if (!detailText && (md || body)) {
        const scanText = (o: unknown): string => {
          if (!o || typeof o !== 'object') return '';
          const obj = o as Record<string, unknown>;
          if (typeof obj.textMessage === 'string') return obj.textMessage;
          if (typeof obj.text === 'string') return obj.text;
          for (const v of Object.values(obj)) {
            const found = scanText(v);
            if (found) return found;
          }
          return '';
        };
        detailText = (scanText(md) || scanText(body) || '').trim();
      }
      if (!detailText) detailText = (incomingText || '').trim();
      const isIrrelevant = /^(מה השעה|מי אתה|מה אתה|למה|איך|מתי|היי|שלום|הי|בוקר טוב|ערב טוב)\??$/i.test(detailText);
      if (!isIrrelevant && detailText.length >= 2) {
        state.accumulatedData = state.accumulatedData || {};
        state.accumulatedData.detailedDescription = detailText;
        state.state = 'waiting_for_city';
        await state.save();
        await sendMessage(senderId, "באיזו עיר אתה נמצא?");
        return NextResponse.json({ status: 'ok' });
      }
      // Don't resend prompt if we got no text - avoids loop from empty/duplicate webhooks
      if (detailText) await sendMessage(senderId, "אנא תאר/י במפורט מהי מטרת הפנייה:");
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
      let choice = (selectedButtonId || incomingText || '').trim().toLowerCase();
      // Green API may send selectedId as "0"/"1" for button index - map to our ids
      if (choice === '0') choice = 'consent_yes';
      if (choice === '1') choice = 'consent_no';
      const isYes = choice === 'consent_yes' || /כן|ken|yes/.test(choice);
      const isNo = choice === 'consent_no' || /^לא$|^no$/.test(choice);
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
  // Use raw text as fallback - scan or other logic might have corrupted incomingText
  const md = body?.messageData || {};
  const rawText = md.textMessageData?.textMessage || md.extendedTextMessageData?.text ||
    (md.typeMessage === 'quotedMessage' && (md.quotedMessage?.extendedTextMessageData?.text || md.extendedTextMessageData?.text)) || '';
  const effectiveText = ((text || '').trim() || (rawText || '').trim()).trim();
  console.log(`handleClientFlow - State: ${state.state}, Text: "${effectiveText}"`);
  
  // If waiting for offers - any message resets and starts new conversation as client
  if (state.state === 'waiting_for_offers') {
    await ConversationState.updateOne(
      { phone: state.phone },
      {
        $set: {
          state: 'choosing_profession',
          accumulatedData: {},
          lastJobId: null,
          chatHistory: [],
        },
        $unset: { completedJobId: 1 },
      }
    );
    const refreshed = await ConversationState.findOne({ phone: state.phone });
    if (refreshed) await sendProfessionSelectionUnlessCooldown(senderId, refreshed);
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
  
  // Check for completely irrelevant messages (questions, random text) - use effectiveText
  const isIrrelevant = /^(מה השעה|מי אתה|מה אתה|למה|איך|מתי|היי|שלום|הי|בוקר טוב|ערב טוב)\??$/i.test(effectiveText);
  
  // Step 1: welcome - collect problem description
  if (state.state === 'welcome') {
    if (isIrrelevant || effectiveText.length < 3) {
      await sendMessage(senderId, "היי! 👋 אני כאן לעזור לך למצוא בעל מקצוע.\nספר לי מה הבעיה שלך? (למשל: יש לי נזילה בכיור)");
      return;
    }
    const problemType = detectProblemType(effectiveText);
    state.accumulatedData = { problemType, initialDescription: effectiveText };
    state.state = 'waiting_for_details';
    await state.save();
    await sendMessage(senderId, "אנא תאר/י במפורט מהי מטרת הפנייה:");
    return;
  }

  // Step 2: waiting_for_details - collect more details (initialDescription stays from welcome)
  if (state.state === 'waiting_for_details') {
    if (isIrrelevant || effectiveText.length < 5) {
      await sendMessage(senderId, "אנא תאר/י במפורט מהי מטרת הפנייה:");
      return;
    }
    state.accumulatedData.detailedDescription = effectiveText;
    state.state = 'waiting_for_city';
    await state.save();
    await sendMessage(senderId, "באיזו עיר אתה נמצא?");
    return;
  }

  // Step 3: waiting_for_city - collect city and finalize
  if (state.state === 'waiting_for_city') {
    // Check if it looks like a city name (short, Hebrew, no numbers)
    const cityText = effectiveText.trim();
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
