import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  buildClassificationSystemPrompt,
  intentFromModelText,
  wrapUserMessage,
} from './classification.js';
import { UNRECOGNIZED_INTENT, type Intent } from './intent.js';
import { LlmError, type LlmProvider } from './llm-provider.js';

const CLASSIFY_MAX_TOKENS = 512;
const COMPLETE_MAX_TOKENS = 1024;

export type BedrockProviderOptions = {
  region?: string;
  modelId?: string;
  client?: BedrockRuntimeClient;
};

/** LlmProvider backed by the model-agnostic Bedrock Converse API. */
export class BedrockProvider implements LlmProvider {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(options: BedrockProviderOptions = {}) {
    const modelId = options.modelId ?? process.env['BEDROCK_MODEL_ID'];
    if (!modelId) throw new Error('BEDROCK_MODEL_ID is not set');
    this.modelId = modelId;
    const region = options.region ?? process.env['AWS_REGION'];
    this.client = options.client ?? new BedrockRuntimeClient({ region });
  }

  private async converse(
    system: string | undefined,
    userText: string,
    maxTokens: number,
  ): Promise<string> {
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        ...(system !== undefined ? { system: [{ text: system }] } : {}),
        messages: [{ role: 'user', content: [{ text: userText }] }],
        inferenceConfig: { maxTokens, temperature: 0 },
      }),
    );
    const parts = response.output?.message?.content ?? [];
    return parts.map((p) => p.text ?? '').join('');
  }

  async complete(prompt: string): Promise<string> {
    let text: string;
    try {
      text = await this.converse(undefined, prompt, COMPLETE_MAX_TOKENS);
    } catch (cause) {
      throw new LlmError('complete', cause);
    }
    if (text.trim() === '') throw new LlmError('complete');
    return text;
  }

  async classifyIntent(message: string, intentNames: string[]): Promise<Intent> {
    if (intentNames.length === 0 || message.trim() === '') {
      return { name: UNRECOGNIZED_INTENT, parameters: {}, rawMessage: message };
    }
    let text: string;
    try {
      text = await this.converse(
        buildClassificationSystemPrompt(intentNames),
        wrapUserMessage(message),
        CLASSIFY_MAX_TOKENS,
      );
    } catch (cause) {
      throw new LlmError('classifyIntent', cause);
    }
    return intentFromModelText(text, message, intentNames);
  }
}
