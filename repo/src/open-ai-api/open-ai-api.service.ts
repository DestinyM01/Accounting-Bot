import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { MessageParam } from '@anthropic-ai/sdk/resources/messages';

@Injectable()
export class OpenAiApiService {
  private readonly logger: Logger = new Logger(OpenAiApiService.name);
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    const apiKey = configService.getOrThrow('ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
  }

  async generateResponse(messages: MessageParam[]): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages,
      });
      this.logger.log(`input_tokens:${response.usage.input_tokens} output_tokens:${response.usage.output_tokens}`);
      const block = response.content[0];
      return block.type === 'text' ? block.text : '';
    } catch (e) {
      this.logger.error('generateResponse error', e);
      throw e;
    }
  }
}
