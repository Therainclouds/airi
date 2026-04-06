const TAG_OPEN = '<|'
const TAG_CLOSE = '|>'
const ESCAPED_TAG_OPEN = '<{\'|\'}'
const ESCAPED_TAG_CLOSE = '{\'|\'}>'
const ACT_PREFIXES = ['<|ACT', '<ACT', '{ACT']

interface MarkerToken {
  type: 'literal' | 'special'
  value: string
}

interface MarkerParserOptions {
  minLiteralEmitLength?: number
}

interface StreamController<T> {
  stream: ReadableStream<T>
  write: (value: T) => void
  close: () => void
  error: (err: unknown) => void
}

function createPushStream<T>(): StreamController<T> {
  let closed = false
  let controller: ReadableStreamDefaultController<T> | null = null

  const stream = new ReadableStream<T>({
    start(ctrl) {
      controller = ctrl
    },
    cancel() {
      closed = true
    },
  })

  return {
    stream,
    write(value) {
      if (!controller || closed)
        return
      controller.enqueue(value)
    },
    close() {
      if (!controller || closed)
        return
      closed = true
      controller.close()
    },
    error(err) {
      if (!controller || closed)
        return
      closed = true
      controller.error(err)
    },
  }
}

function findEarliestActPrefix(source: string, fromIndex = 0): number {
  const indexes = ACT_PREFIXES
    .map(prefix => source.indexOf(prefix, fromIndex))
    .filter(index => index >= 0)

  return indexes.length > 0 ? Math.min(...indexes) : -1
}

function findPendingActPrefix(source: string): number {
  for (let index = 0; index < source.length; index++) {
    const tail = source.slice(index)
    if (
      tail.length >= 2
      && ACT_PREFIXES.some(prefix => tail.startsWith(prefix) || prefix.startsWith(tail))
    ) {
      return index
    }
  }

  return -1
}

function tryExtractActToken(source: string, fromIndex = 0): { start: number, end: number, value: string } | null {
  const start = findEarliestActPrefix(source, fromIndex)
  if (start < 0)
    return null

  const jsonStart = source.indexOf('{', start + 1)
  if (jsonStart < 0)
    return null

  let cursor = jsonStart
  let depth = 0
  let inString = false
  let escaped = false

  while (cursor < source.length) {
    const char = source[cursor]
    if (escaped) {
      escaped = false
    }
    else if (char === '\\') {
      escaped = true
    }
    else if (char === '"') {
      inString = !inString
    }
    else if (!inString && char === '{') {
      depth++
    }
    else if (!inString && char === '}') {
      depth--
      if (depth === 0) {
        let end = cursor + 1
        if (source.slice(end, end + TAG_CLOSE.length) === TAG_CLOSE) {
          end += TAG_CLOSE.length
        }
        else if (source.startsWith('<|ACT', start) && source[end] === '>') {
          end += 1
        }
        else if (source.startsWith('<ACT', start)) {
          if (source[end] !== '>')
            return null
          end += 1
        }
        return {
          start,
          end,
          value: source.slice(start, end),
        }
      }
    }
    cursor++
  }

  return null
}

export function stripLlmControlTokens(value: string): string {
  let output = ''
  let cursor = 0

  while (cursor < value.length) {
    const actToken = tryExtractActToken(value, cursor)
    if (!actToken) {
      output += value.slice(cursor)
      break
    }

    output += value.slice(cursor, actToken.start)
    cursor = actToken.end
  }

  return output
    .replace(/<\|DELAY:\d+\|>/gi, '')
    .trim()
}

async function readStream<T>(stream: ReadableStream<T>, handler: (value: T) => Promise<void> | void) {
  const reader = stream.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done)
        break
      await handler(value as T)
    }
  }
  finally {
    reader.releaseLock()
  }
}

function createLlmMarkerParser(options?: MarkerParserOptions) {
  const minLiteralEmitLength = Math.max(1, options?.minLiteralEmitLength ?? 1)
  const tailLength = Math.max(TAG_OPEN.length - 1, ESCAPED_TAG_OPEN.length - 1)
  let buffer = ''
  let inTag = false

  return {
    async consume(textPart: string, onLiteral: (value: string) => Promise<void> | void, onSpecial: (value: string) => Promise<void> | void) {
      buffer += textPart
      buffer = buffer
        .replaceAll(ESCAPED_TAG_OPEN, TAG_OPEN)
        .replaceAll(ESCAPED_TAG_CLOSE, TAG_CLOSE)

      while (buffer.length > 0) {
        if (!inTag) {
          const actToken = tryExtractActToken(buffer)
          const openTagIndex = buffer.indexOf(TAG_OPEN)
          if (actToken && (openTagIndex < 0 || actToken.start <= openTagIndex)) {
            if (actToken.start > 0) {
              const emit = buffer.slice(0, actToken.start)
              buffer = buffer.slice(actToken.start)
              await onLiteral(emit)
              continue
            }

            buffer = buffer.slice(actToken.end)
            await onSpecial(actToken.value)
            continue
          }

          if (openTagIndex < 0) {
            const pendingActIndex = findPendingActPrefix(buffer)
            if (pendingActIndex >= 0) {
              if (pendingActIndex > 0) {
                const emit = buffer.slice(0, pendingActIndex)
                buffer = buffer.slice(pendingActIndex)
                await onLiteral(emit)
              }
              break
            }

            if (buffer.length - tailLength >= minLiteralEmitLength) {
              const emit = buffer.slice(0, -tailLength)
              buffer = buffer.slice(-tailLength)
              await onLiteral(emit)
            }
            break
          }

          if (openTagIndex > 0) {
            const emit = buffer.slice(0, openTagIndex)
            buffer = buffer.slice(openTagIndex)
            await onLiteral(emit)
          }
          inTag = true
        }
        else {
          if (buffer.startsWith('<|ACT')) {
            const actToken = tryExtractActToken(buffer)
            if (actToken && actToken.start === 0) {
              buffer = buffer.slice(actToken.end)
              await onSpecial(actToken.value)
              inTag = false
              continue
            }
          }

          const closeTagIndex = buffer.indexOf(TAG_CLOSE)
          if (closeTagIndex < 0)
            break

          const emit = buffer.slice(0, closeTagIndex + TAG_CLOSE.length)
          buffer = buffer.slice(closeTagIndex + TAG_CLOSE.length)
          await onSpecial(emit)
          inTag = false
        }
      }
    },

    async end(onLiteral: (value: string) => Promise<void> | void) {
      if (!inTag && buffer.length > 0) {
        await onLiteral(buffer)
        buffer = ''
      }
    },
  }
}

function createLlmMarkerStream(input: ReadableStream<string>, options?: MarkerParserOptions) {
  const { stream, write, close, error } = createPushStream<MarkerToken>()
  const parser = createLlmMarkerParser(options)

  void readStream(input, async (chunk) => {
    await parser.consume(
      chunk,
      async (literal) => {
        if (!literal)
          return
        write({ type: 'literal', value: literal })
      },
      async (special) => {
        write({ type: 'special', value: special })
      },
    )
  })
    .then(async () => {
      await parser.end(async (literal) => {
        if (!literal)
          return
        write({ type: 'literal', value: literal })
      })
      close()
    })
    .catch((err) => {
      error(err)
    })

  return stream
}

/**
 * A streaming parser for LLM responses that contain special markers (e.g., for tool calls).
 * This composable is designed to be efficient and robust, using a stream-based parser
 * to handle special tags enclosed in `<|...|>`.
 *
 * @example
 * const parser = useLlmmarkerParser({
 *   onLiteral: (text) => console.log('Literal:', text),
 *   onSpecial: (tagContent) => console.log('Special:', tagContent),
 * });
 *
 * await parser.consume('This is some text <|tool_code|> and some more |> text.');
 * await parser.end();
 */
export function useLlmmarkerParser(options: {
  onLiteral?: (literal: string) => void | Promise<void>
  onSpecial?: (special: string) => void | Promise<void>
  /**
   * Called when parsing ends with the full accumulated text.
   * Useful for final processing like categorization or filtering.
   */
  onEnd?: (fullText: string) => void | Promise<void>
  /**
   * The minimum length of text required to emit a literal part.
   * Useful for avoiding emitting literal parts too fast.
   */
  minLiteralEmitLength?: number
}) {
  let fullText = ''
  const { stream, write, close } = createPushStream<string>()

  const markerStream = createLlmMarkerStream(stream, { minLiteralEmitLength: options.minLiteralEmitLength })

  const processing = readStream(markerStream, async (token) => {
    if (token.type === 'literal')
      await options.onLiteral?.(token.value)
    if (token.type === 'special')
      await options.onSpecial?.(token.value)
  })

  return {
    /**
     * Consumes a chunk of text from the stream.
     * @param textPart The chunk of text to consume.
     */
    async consume(textPart: string) {
      fullText += textPart
      write(textPart)
    },

    /**
     * Finalizes the parsing process.
     * Any remaining content in the buffer is flushed as a final literal part.
     * This should be called after the stream has ended.
     */
    async end() {
      close()
      await processing
      await options.onEnd?.(fullText)
    },
  }
}
