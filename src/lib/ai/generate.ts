import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import {
  mergeLeadProfile,
  sanitizeLeadProfile,
  type LeadProfile,
} from '@/lib/neodomus'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const { text: withoutLead, lead } = extractLeadBlocks(raw)
  const handoff = withoutLead.includes(HANDOFF_SENTINEL)
  const text = withoutLead.split(HANDOFF_SENTINEL).join('').trim()
  return lead ? { text, handoff, usage, lead } : { text, handoff, usage }
}

const LEAD_BLOCK = /\[\[\s*LEAD\s*(\{[\s\S]*?\})\s*\]\]/g
/** A marker the model started but never closed (output cut off by the
 *  token cap, malformed JSON…). Everything from it to the end goes. */
const DANGLING_LEAD = /\[\[\s*LEAD[\s\S]*$/

/**
 * Pull every `[[LEAD {...}]]` block out of the model output. The marker
 * must NEVER reach the customer, so it is stripped even when its JSON is
 * invalid; only valid, sanitized JSON is returned as `lead`.
 */
export function extractLeadBlocks(raw: string): {
  text: string
  lead: LeadProfile | null
} {
  let lead: LeadProfile | null = null
  const text = raw
    .replace(LEAD_BLOCK, (_, json: string) => {
      try {
        lead = mergeLeadProfile(lead, sanitizeLeadProfile(JSON.parse(json)))
      } catch {
        // Malformed JSON — drop the block, keep the reply.
      }
      return ''
    })
    .replace(DANGLING_LEAD, '')
  return { text, lead }
}
