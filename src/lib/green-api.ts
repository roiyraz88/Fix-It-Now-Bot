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

export interface InteractiveButton {
  buttonId: string;
  buttonText: string;
}

/**
 * Sends a message with interactive buttons (SendInteractiveButtonsReply).
 * Max 3 buttons, max 25 chars per button.
 */
export async function sendInteractiveButtonsReply(
  chatId: string,
  body: string,
  buttons: InteractiveButton[],
  header?: string,
  footer?: string
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendInteractiveButtonsReply/${GREEN_API_CONFIG.apiTokenInstance}`;

  const requestBody = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    body,
    header: header || '',
    footer: footer || '',
    buttons,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('Green API sendInteractiveButtonsReply Error:', responseText);
    throw new Error(`Green API error: ${response.status}`);
  }
  return JSON.parse(responseText);
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
 * Sends a list message (more stable and supported than buttons).
 */
export async function sendListMessage(
  chatId: string,
  message: string,
  buttonText: string,
  sections: { title: string; rows: { rowId: string; title: string; description?: string }[] }[],
  footer?: string,
  title?: string
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendListMessage/${GREEN_API_CONFIG.apiTokenInstance}`;
  
  const body = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    message,
    buttonText,
    sections,
    footer: footer || '',
    title: title || ''
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('Green API sendListMessage Error:', responseText);
    throw new Error(`Green API error: ${response.status}`);
  }
  return JSON.parse(responseText);
}

/**
 * Sends a message with interactive buttons (Standard).
 */
export async function sendButtons(
  chatId: string,
  message: string,
  buttons: Button[],
  footer?: string
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendButtons/${GREEN_API_CONFIG.apiTokenInstance}`;
  
  const body = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    message,
    footer: footer || '',
    buttons,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('Green API sendButtons Error:', responseText);
    throw new Error(`Green API error: ${response.status}`);
  }
  return JSON.parse(responseText);
}

export interface SendContactParams {
  phoneContact: number;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  company?: string;
}

/**
 * Sends a contact (vCard) message to a chat.
 * phoneContact: intl format 11-16 digits, no +
 */
export async function sendContact(
  chatId: string,
  contact: SendContactParams,
  options?: { quotedMessageId?: string; typingTime?: number }
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendContact/${GREEN_API_CONFIG.apiTokenInstance}`;
  const body: Record<string, unknown> = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    contact: {
      phoneContact: contact.phoneContact,
      ...(contact.firstName && { firstName: contact.firstName }),
      ...(contact.middleName && { middleName: contact.middleName }),
      ...(contact.lastName && { lastName: contact.lastName }),
      ...(contact.company && { company: contact.company }),
    },
  };
  if (options?.quotedMessageId) body.quotedMessageId = options.quotedMessageId;
  if (options?.typingTime) body.typingTime = options.typingTime;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    console.error('Green API sendContact Error:', responseText);
    throw new Error(`Green API error: ${response.status}`);
  }
  return JSON.parse(responseText);
}

/** Get contact info (name etc.) - chatId format: 972521234567@c.us */
export async function getContactInfo(chatId: string): Promise<{ name?: string; contactName?: string }> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/getContactInfo/${GREEN_API_CONFIG.apiTokenInstance}`;
  const body = { chatId: chatId.includes('@') ? chatId : `${chatId}@c.us` };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error('Green API getContactInfo Error:', data);
    return {};
  }
  return { name: data.name || '', contactName: data.contactName || '' };
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

/**
 * Sends an image by URL to a chat.
 */
export async function sendFileByUrl(
  chatId: string,
  urlFile: string,
  caption?: string,
  fileName?: string
): Promise<SendMessageResponse> {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/sendFileByUrl/${GREEN_API_CONFIG.apiTokenInstance}`;
  
  const body = {
    chatId: chatId.includes('@') ? chatId : `${chatId}@c.us`,
    urlFile,
    fileName: fileName || 'image.jpg',
    caption: caption || ''
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('Green API sendFileByUrl Error:', responseText);
    throw new Error(`Green API error: ${response.status}`);
  }
  return JSON.parse(responseText);
}

export async function setSettings(settings: any) {
  const url = `${GREEN_API_CONFIG.apiUrl}/waInstance${GREEN_API_CONFIG.idInstance}/setSettings/${GREEN_API_CONFIG.apiTokenInstance}`;
  const body = {
    ...settings,
    incomingWebhook: 'yes',
    stateWebhook: 'yes',
    outgoingWebhook: 'no',
    incomingMessageWebhook: 'yes',
    incomingButtonsResponseMessageWebhook: 'yes',
    incomingTemplateButtonsReplyMessageWebhook: 'yes'
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return response.json();
}
