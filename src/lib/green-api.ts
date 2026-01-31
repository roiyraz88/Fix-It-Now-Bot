export const GREEN_API_CONFIG = {
  apiUrl: process.env.GREEN_API_URL || 'https://7103.api.greenapi.com',
  mediaUrl: process.env.GREEN_API_MEDIA_URL || 'https://7103.media.greenapi.com',
  idInstance: process.env.GREEN_API_ID_INSTANCE || '',
  apiTokenInstance: process.env.GREEN_API_TOKEN_INSTANCE || '',
};

export const MONGODB_URI = process.env.MONGODB_URI || '';

export interface CustomPreview {
  title: string;
  description?: string;
  link?: string;
  urlFile?: string;
  jpegThumbnail?: string;
}

export interface SendMessageOptions {
  quotedMessageId?: string;
  linkPreview?: boolean;
  typePreview?: 'large' | 'small';
  customPreview?: CustomPreview;
  typingTime?: number;
}

export interface SendMessageResponse {
  idMessage: string;
}

export interface Button {
  buttonId: string;
  buttonText: string;
}

/**
 * Sends a text message to a personal or a group chat.
 */
export async function sendMessage(
  chatId: string,
  message: string,
  options: SendMessageOptions = {}
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendMessage/${GREEN_API_CONFIG.apiTokenInstance}`;
  
  const body = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    message,
    ...options,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error('Green API Error Response:', responseText);
    try {
      const errorData = JSON.parse(responseText);
      throw new Error(errorData.message || `Green API error: ${response.status}`);
    } catch {
      throw new Error(`Green API error: ${response.status} - ${responseText.substring(0, 100)}`);
    }
  }

  try {
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Failed to parse Green API response as JSON:', responseText);
    throw new Error('Green API returned non-JSON response');
  }
}

/**
 * Sends a message with interactive buttons.
 */
export async function sendButtons(
  chatId: string,
  message: string,
  buttons: Button[],
  footer?: string,
  header?: string
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendInteractiveButtonsReply/${GREEN_API_CONFIG.apiTokenInstance}`;
  
  const body = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    header: header || '',
    body: message,
    footer: footer || '',
    buttons,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error('Green API sendInteractiveButtonsReply Error:', responseText);
    try {
      const errorData = JSON.parse(responseText);
      throw new Error(errorData.message || `Green API error: ${response.status}`);
    } catch {
      throw new Error(`Green API error: ${response.status} - ${responseText.substring(0, 100)}`);
    }
  }

  try {
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Failed to parse Green API response as JSON:', responseText);
    throw new Error('Green API returned non-JSON response');
  }
}

export async function getSettings() {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/getSettings/${GREEN_API_CONFIG.apiTokenInstance}`;
  const response = await fetch(url);
  return response.json();
}

export async function getStateInstance() {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/getStateInstance/${GREEN_API_CONFIG.apiTokenInstance}`;
  const response = await fetch(url);
  return response.json();
}

export async function setSettings(settings: any) {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/setSettings/${GREEN_API_CONFIG.apiTokenInstance}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  return response.json();
}
