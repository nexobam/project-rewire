// APIキー漏洩防止マスク機能付きセキュアロガー（要件8-3）

const GOOGLE_API_KEY_PATTERN = /AIza[0-9A-Za-z\-_]{15,}/g;
const KEY_PARAM_PATTERN = /([?&](?:key|api_key|apiKey)=)([^&\s]+)/gi;
const BEARER_PATTERN = /(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi;

/**
 * 任意の文字列やエラーオブジェクトからAPIキーやトークンを `***MASKED***` に置換する
 */
export function maskSensitiveText(
  input: unknown,
  knownApiKey?: string
): string {
  let text: string;
  if (input instanceof Error) {
    text = `${input.name}: ${input.message}`;
  } else if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = JSON.stringify(input) ?? String(input);
    } catch {
      text = String(input);
    }
  }

  if (knownApiKey && knownApiKey.trim().length >= 4) {
    const escaped = knownApiKey
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'g'), '***MASKED_API_KEY***');
  }

  text = text.replace(GOOGLE_API_KEY_PATTERN, '***MASKED_API_KEY***');
  text = text.replace(KEY_PARAM_PATTERN, '$1***MASKED_API_KEY***');
  text = text.replace(BEARER_PATTERN, '$1***MASKED_TOKEN***');

  return text;
}

export const secureLogger = {
  info(message: unknown, knownApiKey?: string): void {
    console.info(maskSensitiveText(message, knownApiKey));
  },
  warn(message: unknown, knownApiKey?: string): void {
    console.warn(maskSensitiveText(message, knownApiKey));
  },
  error(message: unknown, knownApiKey?: string): void {
    console.error(maskSensitiveText(message, knownApiKey));
  },
};
