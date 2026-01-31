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

export async function analyzeClientMessage(text: string): Promise<AnalysisResult> {
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

