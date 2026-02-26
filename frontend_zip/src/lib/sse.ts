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

  function parseBlock(block: string) {
    const lines = block.split('\n');
    let event = '';
    const dataLines: string[] = [];

    lines.forEach((line) => {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    });

    if (!event) return;

    const rawData = dataLines.join('');
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

    if (typeof handlers[event] === 'function') {
      handlers[event](payload);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let marker = buffer.indexOf('\n\n');
    while (marker !== -1) {
      const raw = buffer.slice(0, marker).trim();
      buffer = buffer.slice(marker + 2);
      if (raw) parseBlock(raw);
      marker = buffer.indexOf('\n\n');
    }
  }

  const rest = buffer.trim();
  if (rest) parseBlock(rest);
}
