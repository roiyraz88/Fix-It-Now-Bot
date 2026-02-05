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
    priceEstimation?: {
      min: number;
      max: number;
      explanation: string;
    };
  };
}

export async function generateChatResponse(
  message: string, 
  history: { role: 'user' | 'assistant', content: string }[] = []
): Promise<ChatResult> {
  const systemPrompt = `
    אתה עוזר חכם של FixItNow, בוט AI שעוזר לאנשים למצוא בעלי מקצוע (אינסטלציה, חשמל, מיזוג).
    המטרה שלך היא לנהל שיחה נעימה, אנושית ומבינה עם הלקוח, ולחלץ ממנו את המידע הדרוש כדי לפתוח קריאת שירות.

    המידע שאתה צריך כדי להכריז שאתה "מוכן" (isReadyForJob: true):
    1. מה הבעיה (סוג הבעיה ותיאור ברור).
    2. עיר.
    
    הנחיות לשיחה:
    - אם הלקוח אומר "היי" או "שלום", ענה בנחמדות ושאל איך אפשר לעזור היום. אל תהיה רובוטי.
    - תן הרגשה שאתה מבין את התסכול שלו מהתקלה.
    - אם יש מספיק מידע על התקלה, תן הערכת מחיר (טווח) והסבר קצר על מה יכולה להיות הבעיה.
    - תמיד תהיה מנומס ותשתמש באמוג'ים מתאימים 🛠️⚡🚰.
    - אם חסר מידע (כמו עיר), בקש אותו בצורה טבעית בתוך התשובה שלך.

    פורמט תשובה (JSON בלבד):
    - response: התשובה הטקסטואלית שלך ללקוח בשיחה.
    - isReadyForJob: האם יש לך כבר את סוג הבעיה, התיאור והעיר? (true/false)
    - extractedData: (רק אם isReadyForJob הוא true) אובייקט עם:
        - problemType: "plumber", "electrician" או "ac"
        - city: שם העיר בעברית
        - urgency: "low", "medium" או "high"
        - description: תיאור קצר ומקצועי של הבעיה
        - priceEstimation: אובייקט עם min, max והסבר (כמו שמוצג ללקוח)
  `;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message }
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages as any,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('OpenAI returned empty response');

  return JSON.parse(content) as ChatResult;
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

