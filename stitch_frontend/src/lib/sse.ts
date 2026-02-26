export function decodeBase64Utf8(base64: string): string {
  try {
    const raw = window.atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (_error) {
    return '';
  }
}

export async function consumeSse(
  response: Response,
  handlers: Record<string, (payload: any) => void>
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No hay stream disponible');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentDataLines: string[] = [];

  function normalizeChunk(chunk: string): string {
    return chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function dispatchCurrentEvent() {
    if (!currentEvent) {
      currentDataLines = [];
      return;
    }

    const rawData = currentDataLines.join('');
    let payload: any = null;

    if (rawData) {
      const decoded = decodeBase64Utf8(rawData);
      if (decoded) {
        try {
          payload = JSON.parse(decoded);
        } catch (_error) {
          payload = null;
        }
      }
    }

    if (typeof handlers[currentEvent] === 'function') {
      handlers[currentEvent](payload);
    }

    currentEvent = '';
    currentDataLines = [];
  }

  function processLine(rawLine: string) {
    const line = rawLine;
    if (line === '') {
      dispatchCurrentEvent();
      return;
    }

    if (line.startsWith(':')) {
      return;
    }

    const separator = line.indexOf(':');
    let field = line;
    let value = '';
    if (separator >= 0) {
      field = line.slice(0, separator);
      value = line.slice(separator + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
    }

    if (field === 'event') {
      currentEvent = value.trim();
      return;
    }

    if (field === 'data') {
      currentDataLines.push(value.trim());
    }
  }

  function processBufferedLines() {
    let marker = buffer.indexOf('\n');
    while (marker !== -1) {
      const line = buffer.slice(0, marker);
      buffer = buffer.slice(marker + 1);
      processLine(line);
      marker = buffer.indexOf('\n');
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += normalizeChunk(decoder.decode(value, { stream: true }));
    processBufferedLines();
  }

  buffer += normalizeChunk(decoder.decode());
  processBufferedLines();
  if (buffer.length > 0) {
    processLine(buffer);
    buffer = '';
  }
  dispatchCurrentEvent();
}
