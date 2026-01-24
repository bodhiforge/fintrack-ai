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
 * Download file from Telegram servers
 */
export async function downloadTelegramFile(
  fileId: string,
  botToken: string
): Promise<Blob> {
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

  // Step 2: Download the actual file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
  const fileResponse = await fetch(fileUrl);

  if (!fileResponse.ok) {
    throw new Error(`Failed to download file: ${fileResponse.status}`);
  }

  return await fileResponse.blob();
}
