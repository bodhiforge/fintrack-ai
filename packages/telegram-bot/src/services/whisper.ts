/**
 * OpenAI Whisper Speech-to-Text Service
 */

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface TranscriptionResult {
  readonly text: string;
  readonly duration?: number;
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  language?: string
): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'voice.ogg');
  formData.append('model', 'whisper-1');

  // Optional: specify language for better accuracy
  if (language != null) {
    formData.append('language', language);
  }

  const response = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error: ${response.status} - ${error}`);
  }

  const result = await response.json() as { text: string };

  return {
    text: result.text.trim(),
  };
}

/**
 * Result of downloading a file from Telegram
 */
export interface TelegramFileResult {
  readonly blob: Blob;
  readonly filePath: string;
  readonly mimeType: string;
}

/**
 * Infer MIME type from file path
 */
function inferMimeType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'ogg': 'audio/ogg',
    'oga': 'audio/ogg',
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
  };
  return mimeTypes[extension ?? ''] ?? 'application/octet-stream';
}

/**
 * Download file from Telegram servers
 */
export async function downloadTelegramFile(
  fileId: string,
  botToken: string
): Promise<TelegramFileResult> {
  // Step 1: Get file path from Telegram
  const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const fileInfoResponse = await fetch(getFileUrl);

  if (!fileInfoResponse.ok) {
    throw new Error(`Failed to get file info: ${fileInfoResponse.status}`);
  }

  const fileInfo = await fileInfoResponse.json() as {
    ok: boolean;
    result?: { file_path: string };
  };

  if (!fileInfo.ok || fileInfo.result?.file_path == null) {
    throw new Error('Failed to get file path from Telegram');
  }

  const filePath = fileInfo.result.file_path;

  // Step 2: Download the actual file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const fileResponse = await fetch(fileUrl);

  if (!fileResponse.ok) {
    throw new Error(`Failed to download file: ${fileResponse.status}`);
  }

  const blob = await fileResponse.blob();
  const mimeType = inferMimeType(filePath);

  return { blob, filePath, mimeType };
}
