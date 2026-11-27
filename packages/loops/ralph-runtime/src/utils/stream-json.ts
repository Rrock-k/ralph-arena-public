/**
 * Extract human-readable text from Claude CLI stream-json (NDJSON) output.
 * The stream-json format has one JSON object per line: system, assistant, result, etc.
 * We extract text blocks from assistant messages and the final result.
 * 
 * Used by Planner, Controller, and any other module parsing raw Claude CLI output.
 */
export function extractTextFromStreamJson(output: string): string {
  // Quick check: if it doesn't look like NDJSON, return as-is
  const firstLine = output.trim().split('\n')[0] || '';
  if (!firstLine.startsWith('{')) {
    return output;
  }

  const assistantParts: string[] = [];
  const resultParts: string[] = [];
  const plainTextParts: string[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);

      // Extract text from assistant message content blocks
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            assistantParts.push(block.text);
          }
        }
      }

      // Extract text from final result message
      if (msg.type === 'result') {
        if (typeof msg.result === 'string') {
          resultParts.push(msg.result);
        } else if (msg.result?.content) {
          for (const block of msg.result.content) {
            if (block.type === 'text' && block.text) {
              resultParts.push(block.text);
            }
          }
        }
      }
    } catch {
      // Not valid JSON line — could be plain text, just append
      plainTextParts.push(line);
    }
  }

  return mergeExtractedStreamText(
    assistantParts.join('\n'),
    resultParts.join('\n'),
    plainTextParts,
  );
}

export function mergeExtractedStreamText(
  assistantText: string,
  resultText: string,
  extraParts: string[] = [],
): string {
  const assistant = assistantText.trim();
  const result = resultText.trim();
  const extras = extraParts.map((part) => part.trim()).filter(Boolean);

  let merged = '';
  if (assistant && result) {
    if (assistant === result) {
      merged = assistant;
    } else if (assistant.includes(result)) {
      merged = assistant;
    } else if (result.includes(assistant)) {
      merged = result;
    } else {
      merged = `${assistant}\n${result}`;
    }
  } else {
    merged = assistant || result;
  }

  return [merged, ...extras].filter(Boolean).join('\n');
}
