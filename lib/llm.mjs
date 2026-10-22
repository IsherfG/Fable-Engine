/**
 * Streaming chat client for the Command Code Provider API.
 *
 * The Provider API is OpenAI-compatible on /chat/completions, so this is a
 * plain OpenAI-style SSE reader with no SDK dependency.
 *
 * Endpoint map (from GET /provider/v1/models -> supported_endpoints):
 *   Claude models        -> /messages        (Anthropic Messages wire)
 *   everything else      -> /chat/completions (this file)
 *   some also serve      -> /responses
 */

/**
 * @param {object} opts
 * @param {Array}  opts.messages
 * @param {Array}  [opts.tools]
 * @param {object} opts.llm      config.llm
 * @param {string} opts.apiKey
 * @param {AbortSignal} [opts.signal]
 */
export async function* streamChat({ messages, tools, llm, apiKey, signal }) {
  const body = {
    model: llm.model,
    messages,
    stream: true,
    // NOTE: reasoning models bill thinking against max_tokens. A small budget
    // gets consumed by reasoning and truncates the reply mid-sentence.
    max_tokens: llm.maxTokens ?? 1200,
    temperature: llm.temperature ?? 0.9,
    // Ask for a final usage frame so token counts and cost are real.
    stream_options: { include_usage: true },
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  if (llm.reasoningEffort) body.reasoning_effort = llm.reasoningEffort

  // A stalled upstream must not hold the turn - and the session lock - forever.
  const timeout = AbortSignal.timeout(llm.timeoutMs ?? 60000)
  const guard = signal ? AbortSignal.any([signal, timeout]) : timeout

  let res
  try {
    res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: guard,
    })
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new Error(`Command Code did not respond within ${(llm.timeoutMs ?? 60000) / 1000}s`)
    }
    throw error
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Command Code ${res.status} ${res.statusText}: ${detail.slice(0, 400)}`)
  }
  if (!res.body) throw new Error('Command Code returned no response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason = null
  const toolCalls = []
  let usage = null

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })

    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line || !line.startsWith('data:')) continue

      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        yield { type: 'end', finishReason, toolCalls, usage }
        return
      }

      let parsed
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue // partial frame; the next chunk completes it
      }
      // Usage arrives on a frame carrying no choices, so capture it first.
      if (parsed.usage) usage = parsed.usage

      const choice = parsed.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}

      if (choice.finish_reason) finishReason = choice.finish_reason

      if (delta.reasoning_content) {
        yield { type: 'reasoning', delta: delta.reasoning_content }
      }
      if (delta.content) {
        yield { type: 'text', delta: delta.content }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0
          toolCalls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (tc.id) toolCalls[i].id = tc.id
          if (tc.function?.name) toolCalls[i].function.name += tc.function.name
          if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments
        }
      }
    }
  }

  yield { type: 'end', finishReason, toolCalls, usage }
}

/** Resolve the Command Code API key from the places the CLI/provider use. */
export async function resolveApiKey() {
  if (process.env.COMMAND_CODE_API_KEY) return process.env.COMMAND_CODE_API_KEY

  const { readFile } = await import('node:fs/promises')
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')

  const candidates = [
    join(homedir(), '.commandcode', 'auth.json'),
    join(homedir(), '.pi', 'agent', 'auth.json'),
    join(homedir(), '.omp', 'agent', 'auth.json'),
  ]

  for (const path of candidates) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      const key =
        parsed.apiKey ??
        parsed.commandcode?.access ??
        parsed.commandcode?.key ??
        parsed['command-code']?.key ??
        (typeof parsed.commandcode === 'string' ? parsed.commandcode : undefined)
      if (typeof key === 'string' && key.startsWith('user_')) return key
    } catch {
      // try the next location
    }
  }

  throw new Error(
    'No Command Code API key. Set COMMAND_CODE_API_KEY, or run /login in pi, ' +
      'or write {"apiKey":"user_..."} to ~/.commandcode/auth.json',
  )
}
