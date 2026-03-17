import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AnalysisResult {
  isValid: boolean;
  refusalReason: string | null;
  problemType: 'plumber' | 'electrician' | 'ac' | null;
  city: string | null;
  urgency: 'low' | 'medium' | 'high';
  description: string;
  priceEstimation: {
    min: number;
    max: number;
    explanation: string;
  } | null;
}

export interface ChatResult {
  response: string;
  isReadyForJob: boolean;
  extractedData?: {
    problemType: 'plumber' | 'electrician' | 'ac' | null;
    city: string | null;
    urgency: 'low' | 'medium' | 'high';
    description: string;
  };
}

export async function generateChatResponse(
  message: string, 
  history: { role: 'user' | 'assistant', content: string }[] = []
): Promise<ChatResult> {
  // Quick responses for simple messages (no AI needed - instant response)
  const lowerMsg = message.toLowerCase().trim();
  
  // Greetings
  if (['היי', 'שלום', 'הי', 'בוקר טוב', 'ערב טוב', 'hello', 'hi'].includes(lowerMsg)) {
    return {
      response: "היי! 👋 שמח שפנית אלינו. איך אוכל לעזור לך היום? יש לך תקלה בבית?",
      isReadyForJob: false
    };
  }
  
  // Thanks
  if (['תודה', 'תודה רבה', 'thanks', 'thank you', 'מעולה', 'אחלה'].includes(lowerMsg)) {
    return {
      response: "בשמחה! 😊 אם יש עוד משהו שאוכל לעזור, אני כאן.",
      isReadyForJob: false
    };
  }
  
  // Yes/OK
  if (['כן', 'אוקיי', 'ok', 'yes', 'בסדר', 'יאללה'].includes(lowerMsg)) {
    return {
      response: "מעולה! אז ספר לי - מה התקלה ובאיזו עיר אתה נמצא? 🏠",
      isReadyForJob: false
    };
  }

  // Limit history to last 4 messages for speed
  const limitedHistory = history.slice(-4);

  const systemPrompt = `אתה עוזר של FixItNow. המטרה: לחלץ מהלקוח מה הבעיה ובאיזו עיר הוא נמצא.

כללים:
- תשובות קצרות (2-3 משפטים מקסימום)
- אל תזכיר שליחה לבעלי מקצוע או חיפוש - רק אסוף מידע
- אם יש לך את סוג הבעיה + עיר, סיים בהודעה קצרה כמו "מעולה, קיבלתי את הפרטים!"
- השתמש באמוג'י אחד או שניים מקסימום

פורמט JSON:
- response: התשובה לשלוח ללקוח
- isReadyForJob: true אם יש לך סוג בעיה + תיאור + עיר
- extractedData: (רק אם isReadyForJob=true) { problemType: "plumber"/"electrician"/"ac", city: string, urgency: "low"/"medium"/"high", description: string }`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...limitedHistory,
    { role: 'user', content: message }
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages as any,
    response_format: { type: 'json_object' },
    max_tokens: 300,
    temperature: 0.7,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('OpenAI returned empty response');

  return JSON.parse(content) as ChatResult;
}

export interface PriceEstimation {
  min: number;
  max: number;
  explanation: string;
}

// Maps internal problemType to Hebrew category for AI prompt - MUST match detectProblemType in webhook
function getProblemTypeHebrew(problemType: string): string {
  const map: Record<string, string> = {
    plumber: 'אינסטלציה',
    electrician: 'חשמל',
    ac: 'מיזוג אוויר',
    painter: 'צביעה',
    handyman: 'הנדימן',
    contractor: 'שיפוץ/קבלן',
  };
  return map[problemType] || 'תיקון בית כללי';
}

export async function getPriceEstimation(
  problemType: string,
  description: string,
  detailedDescription: string
): Promise<PriceEstimation> {
  const problemTypeHebrew = getProblemTypeHebrew(problemType);

  const prompt = `אתה מומחה לתיקוני בית בישראל. תן הערכת מחיר לעבודה הבאה.

חשוב: בסיס ההערכה חייב להיות מקרים אמיתיים ומחירי שוק ידועים מישראל (מאתרי שירותים, פורומים, דוגמאות מהאינטרנט). אל תמציא מספרים - השתמש בידע על מחירים ריאליים.

סוג הבעיה: ${problemTypeHebrew}
תיאור ראשוני: ${description}
פירוט נוסף: ${detailedDescription}

החזר JSON עם:
- min: מחיר מינימלי בש"ח (מספר בלבד) - מבוסס מקרים אמיתיים
- max: מחיר מקסימלי בש"ח (מספר בלבד) - מבוסס מקרים אמיתיים
- explanation: הסבר קצר בעברית (2-3 משפטים) על מה משפיע על המחיר ומה יכולה להיות הבעיה

דוגמה לתשובה:
{"min": 150, "max": 400, "explanation": "נזילה בכיור יכולה לנבוע מאטם פגום או צינור סדוק. המחיר תלוי בגישה לצנרת ובחלקים שצריך להחליף."}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 200,
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error('Empty response');
    
    const estimation = JSON.parse(content) as PriceEstimation;
    // העלאת המחירים ב-20%
    const MARKUP = 1.2;
    estimation.min = Math.round(estimation.min * MARKUP);
    estimation.max = Math.round(estimation.max * MARKUP);
    return estimation;
  } catch (error) {
    console.error('Price estimation error:', error);
    // Default estimation if AI fails
    return {
      min: 150,
      max: 500,
      explanation: 'הערכה כללית. המחיר הסופי ייקבע על ידי בעל המקצוע לאחר בדיקה.'
    };
  }
}

export async function analyzeClientMessage(text: string): Promise<AnalysisResult> {
// ... existing code ...
  const prompt = `
    Analyze the following home repair request in Hebrew and extract structured information.
    You must be STRICT. If the message is too short, nonsensical, or doesn't describe a clear home repair problem (plumbing, electricity, or AC), mark it as invalid.

    Return ONLY a JSON object with the following fields:
    - isValid: boolean (true if it's a clear and valid repair request, false otherwise)
    - refusalReason: a polite but firm message in Hebrew explaining why the description is not sufficient if isValid is false, otherwise null.
    - problemType: one of "plumber", "electrician", "ac" (null if invalid)
    - city: the city name in Hebrew, or null if not mentioned
    - urgency: one of "low", "medium", "high"
    - description: a short, structured description of the problem in Hebrew
    - priceEstimation: an object with:
        - min: minimum price in ILS
        - max: maximum price in ILS
        - explanation: a detailed paragraph in Hebrew explaining the repair, what affects the price, and advice.

    You might receive two parts of the problem (Initial problem + Details). Weigh both carefully for the estimation.

    Message: "${text}"
  `;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('OpenAI returned empty response');

  return JSON.parse(content) as AnalysisResult;
}

