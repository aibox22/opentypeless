import log from 'electron-log';
import type { DictationMode, StructuredRewriteResult } from '../../../shared/types/asr';

const logger = log.scope('doubao-formatter-service');

const DOUBAO_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

export interface DoubaoConfig {
  apiKey: string;
  model: string;
}

export class DoubaoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoubaoConfigurationError';
  }
}

export function loadDoubaoConfig(): DoubaoConfig {
  const apiKey = process.env.DOUBAO_API_KEY;
  const model = process.env.DOUBAO_MODEL;

  const missingVars: string[] = [];
  if (!apiKey) {
    missingVars.push('DOUBAO_API_KEY');
  }
  if (!model) {
    missingVars.push('DOUBAO_MODEL');
  }

  if (missingVars.length > 0) {
    throw new DoubaoConfigurationError(
      `Missing required environment variables: ${missingVars.join(', ')}`
    );
  }

  return {
    apiKey: apiKey as string,
    model: model as string,
  };
}

const SYSTEM_PROMPT = `你是一个中文语音输入整理助手。你的任务不是机械润色，而是把一段中文语音识别结果还原成用户真正想输入出去的最终文本。

你的核心目标：
1. 忠实保留原意，不补充用户没有明确表达的新事实。
2. 让结果像用户自己组织得很好时会打出来的中文，清晰、自然、可直接发送或粘贴。

请严格遵守以下整理规则：
1. 去除口癖、重复、停顿词、语气词和无意义衔接词，例如“嗯”“啊”“那个”“就是”“然后”“你知道吧”“大概”等。
2. 处理自我修正时，以用户后面说出的版本为准。若前后出现“不是……是……”“改一下”“准确地说”“更具体一点”等修正痕迹，应删除被推翻的前文，只保留最终想表达的内容。
3. 如果一句话是边想边说出来的，允许你重组语序、合并碎片、补足合理标点，让意思更顺，但不能改变结论。
4. 主动修正常见 ASR 问题，包括同音字、近音词、漏字、多字、断句错误、标点错误和明显不合语境的识别结果。
5. 如果某个词看起来像识别错误，但你无法高置信度判断原词，优先保留语义最稳妥、最中性的表达，不要为了“修正”而编造细节。
6. 若上下文已经足够明确，可以将口语化表达改写为更准确、更自然的书面中文。例如将“需要多进行一个空行及内容和内容之间做空行”整理为“需要在内容和内容之间添加空行”。
7. 输出必须结构化，不能写成一整段。
8. 按语义分段；段落与段落之间必须空一行。
9. 只有在存在多个并列事项、步骤、要求或结论时，才使用阿拉伯数字编号，例如“1.”、“2.”、“3.”；如果只有一个事项或一段自然表达，不要编号。
10. 如果某个编号事项下面还有子项，必须缩进两个空格，并使用小写字母编号，例如：
  a. 第一子项
  b. 第二子项
11. 如果内容本质上是一个连续说明、一个请求、一个结论或一个自然段，即使内容较长，也不要强行编号，只需分段整理。
12. 输出只返回最终整理结果，不要解释，不要总结你的处理过程，不要加前缀，不要使用 Markdown 代码块。`;

function buildUserPrompt(text: string): string {
  return `以下是 ASR 识别结果：

${text}`;
}

export class DoubaoFormatterService {
  async rewriteTranscript(rawText: string): Promise<StructuredRewriteResult> {
    const text = rawText.trim();
    if (!text) {
      return {
        rawText,
        rewrittenText: '',
        mode: 'integrated',
      };
    }

    const config = loadDoubaoConfig();
    logger.info('Formatting transcript with Doubao', {
      textLength: text.length,
      model: config.model,
    });

    const response = await fetch(DOUBAO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(text) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error('Doubao API request failed', {
        status: response.status,
        body,
      });
      throw new Error(`Doubao API failed: ${response.status} - ${body}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rewrittenText = payload.choices?.[0]?.message?.content?.trim() ?? '';

    if (!rewrittenText) {
      throw new Error('Doubao API returned an empty response');
    }

    return {
      rawText,
      rewrittenText,
      mode: 'integrated' satisfies DictationMode,
    };
  }
}

export const doubaoFormatterService = new DoubaoFormatterService();
