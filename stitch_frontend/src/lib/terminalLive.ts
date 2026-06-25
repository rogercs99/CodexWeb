export type TerminalLiveSessionState =
  | 'idle'
  | 'typing'
  | 'blocked'
  | 'waiting_confirmation'
  | 'executing'
  | 'streaming'
  | 'success'
  | 'error'
  | 'canceled'
  | 'timeout'
  | 'exporting'
  | 'copied';

export interface TerminalLiveWarning {
  id: string;
  label: string;
  detail?: string;
}

export interface ParsedCommandBlock {
  command: string;
  lines: string[];
  isMultiline: boolean;
  lineCount: number;
  preview: string;
}

export interface DockerPsEntry {
  containerId: string;
  image: string;
  command: string;
  created: string;
  status: string;
  ports: string;
  names: string;
}

export interface DfEntry {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  use: string;
  mountedOn: string;
}

export interface FreeEntry {
  label: string;
  total: string;
  used: string;
  free: string;
  shared: string;
  buffCache: string;
  available: string;
}

export interface SystemdSummary {
  headline: string;
  loaded: string;
  active: string;
  mainPid: string;
  tasks: string;
  memory: string;
  cpu: string;
  details: string[];
}

export type TerminalLiveSection =
  | { kind: 'docker_ps'; title: string; containers: DockerPsEntry[] }
  | { kind: 'df_h'; title: string; mounts: DfEntry[] }
  | { kind: 'free_h'; title: string; rows: FreeEntry[] }
  | { kind: 'systemd'; title: string; summary: SystemdSummary; logs: string[] }
  | { kind: 'journal'; title: string; lines: string[] }
  | { kind: 'json'; title: string; text: string }
  | { kind: 'raw'; title: string; text: string; tone: 'stdout' | 'stderr' | 'mixed' };

export interface TerminalLiveParsedOutput {
  sections: TerminalLiveSection[];
  urls: string[];
  warnings: TerminalLiveWarning[];
  summary: string;
}

export interface TerminalLiveExportSession {
  command: string;
  startedAt: string;
  finishedAt?: string;
  state: TerminalLiveSessionState;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  warnings?: TerminalLiveWarning[];
  parsed?: TerminalLiveParsedOutput | null;
}

function normalizeText(rawValue: string): string {
  return String(rawValue || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeColumnLabel(rawValue: string): string {
  const value = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (value === 'container id') return 'containerId';
  if (value === 'mounted on') return 'mountedOn';
  if (value === 'use%') return 'use';
  return value.replace(/\s+([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function titleCase(rawValue: string): string {
  return String(rawValue || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(' ');
}

function splitLines(rawValue: string): string[] {
  return normalizeText(rawValue)
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''));
}

function truncateText(rawValue: string, maxLen = 180): string {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 1)).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function extractWarningLines(rawValue: string): TerminalLiveWarning[] {
  const lines = splitLines(rawValue)
    .map((line) => line.trim())
    .filter(Boolean);
  const warnings: TerminalLiveWarning[] = [];
  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (/(permission denied|not found|failed|error|timed out|timeout|denied|forbidden)/.test(lower)) {
      warnings.push({
        id: `warning_${warnings.length + 1}`,
        label: truncateText(line, 120),
        detail: line
      });
    }
  });
  return warnings.slice(0, 8);
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 ms';
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  const mins = Math.floor(seconds / 60);
  const remain = Math.round(seconds % 60);
  return `${mins}m ${String(remain).padStart(2, '0')}s`;
}

function splitNamedSections(rawValue: string): Array<{ title: string; body: string }> {
  const lines = splitLines(rawValue);
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;

  lines.forEach((line) => {
    const marker = /^==+\s*([^=]+?)\s*==+$/.exec(line.trim());
    if (marker && marker[1]) {
      if (current) {
        sections.push(current);
      }
      current = {
        title: titleCase(String(marker[1] || 'Salida').replace(/\s+/g, ' ')),
        body: []
      };
      return;
    }
    if (!current) return;
    current.body.push(line);
  });

  if (current) {
    sections.push(current);
  }

  if (sections.length <= 1) {
    return [];
  }

  return sections
    .map((section) => ({
      title: section.title || 'Salida',
      body: section.body.join('\n').trim()
    }))
    .filter((section) => section.body);
}

export function parseCommandBlock(rawValue: string): ParsedCommandBlock {
  const command = normalizeText(rawValue)
    .replace(/\0/g, '')
    .trim();
  const lines = command ? command.split('\n') : [];
  const firstLine = lines[0] || '';
  const preview =
    lines.length <= 1
      ? truncateText(firstLine, 160)
      : `${truncateText(firstLine, 110)} (+${lines.length - 1} lineas)`;
  return {
    command,
    lines,
    isMultiline: lines.length > 1,
    lineCount: lines.length,
    preview: preview || 'Bloque bash'
  };
}

export function detectDockerPs(rawValue: string): DockerPsEntry[] | null {
  const lines = splitLines(rawValue).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /^CONTAINER ID\s{2,}/i.test(line));
  if (headerIndex === -1 || headerIndex >= lines.length - 1) return null;

  const headerParts = lines[headerIndex].trim().split(/\s{2,}/).map(normalizeColumnLabel);
  if (!headerParts.includes('image') || !headerParts.includes('status') || !headerParts.includes('names')) {
    return null;
  }

  const rows = lines
    .slice(headerIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split(/\s{2,}/);
      const record: Record<string, string> = {};
      headerParts.forEach((label, index) => {
        record[label] = String(columns[index] || '').trim();
      });
      return {
        containerId: record.containerId || '',
        image: record.image || '',
        command: record.command || '',
        created: record.created || '',
        status: record.status || '',
        ports: record.ports || '',
        names: record.names || ''
      } as DockerPsEntry;
    })
    .filter((entry) => entry.containerId && entry.image && entry.names);

  return rows.length > 0 ? rows : null;
}

export function detectDfH(rawValue: string): DfEntry[] | null {
  const lines = splitLines(rawValue).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /^Filesystem\s+/i.test(line));
  if (headerIndex === -1 || headerIndex >= lines.length - 1) return null;

  const rows = lines
    .slice(headerIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tokens = line.split(/\s+/);
      if (tokens.length < 6) return null;
      return {
        filesystem: tokens[0] || '',
        size: tokens[1] || '',
        used: tokens[2] || '',
        avail: tokens[3] || '',
        use: tokens[4] || '',
        mountedOn: tokens.slice(5).join(' ')
      } as DfEntry;
    })
    .filter((entry): entry is DfEntry => Boolean(entry && entry.filesystem && entry.mountedOn));

  return rows.length > 0 ? rows : null;
}

export function detectFreeH(rawValue: string): FreeEntry[] | null {
  const lines = splitLines(rawValue).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /\btotal\b/i.test(line) && /\bused\b/i.test(line) && /\bfree\b/i.test(line));
  if (headerIndex === -1) return null;

  const headerTokens = lines[headerIndex].trim().split(/\s+/);
  const rows = lines
    .slice(headerIndex + 1)
    .map((line) => line.trim())
    .filter((line) => /^(mem:|swap:)/i.test(line))
    .map((line) => {
      const tokens = line.split(/\s+/);
      const label = (tokens.shift() || '').replace(/:$/, '');
      const values = new Map<string, string>();
      headerTokens.forEach((token, index) => {
        values.set(token.toLowerCase(), String(tokens[index] || ''));
      });
      return {
        label: titleCase(label),
        total: values.get('total') || '',
        used: values.get('used') || '',
        free: values.get('free') || '',
        shared: values.get('shared') || '',
        buffCache: values.get('buff/cache') || values.get('buffcache') || '',
        available: values.get('available') || ''
      } as FreeEntry;
    })
    .filter((entry) => entry.label && entry.total);

  return rows.length > 0 ? rows : null;
}

export function detectSystemd(rawValue: string): SystemdSummary | null {
  const lines = splitLines(rawValue).filter((line) => line.trim());
  if (lines.length === 0) return null;

  const headline = lines[0] || '';
  const loadedLine = lines.find((line) => /^\s*Loaded:/i.test(line)) || '';
  const activeLine = lines.find((line) => /^\s*Active:/i.test(line)) || '';
  if (!/\.service\b/i.test(headline) && !activeLine) {
    return null;
  }

  const summary: SystemdSummary = {
    headline,
    loaded: loadedLine.replace(/^\s*Loaded:\s*/i, '').trim(),
    active: activeLine.replace(/^\s*Active:\s*/i, '').trim(),
    mainPid: '',
    tasks: '',
    memory: '',
    cpu: '',
    details: []
  };

  const mainPidLine = lines.find((line) => /^\s*Main PID:/i.test(line)) || '';
  const tasksLine = lines.find((line) => /^\s*Tasks:/i.test(line)) || '';
  const memoryLine = lines.find((line) => /^\s*Memory:/i.test(line)) || '';
  const cpuLine = lines.find((line) => /^\s*CPU:/i.test(line)) || '';

  summary.mainPid = mainPidLine.replace(/^\s*Main PID:\s*/i, '').trim();
  summary.tasks = tasksLine.replace(/^\s*Tasks:\s*/i, '').trim();
  summary.memory = memoryLine.replace(/^\s*Memory:\s*/i, '').trim();
  summary.cpu = cpuLine.replace(/^\s*CPU:\s*/i, '').trim();
  summary.details = lines.slice(1, 8).filter(Boolean);
  return summary;
}

function detectJsonBlock(rawValue: string): string | null {
  const text = String(rawValue || '').trim();
  if (!text) return null;
  if (!(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (_error) {
    return null;
  }
}

function detectJournalLike(command: string, rawValue: string): string[] | null {
  const text = String(rawValue || '').trim();
  if (!text) return null;
  const lines = splitLines(text)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const looksLikeLogs =
    /\bjournalctl\b/i.test(command) ||
    lines.filter((line) => /(\berr(or)?\b|\bwarn(ing)?\b|\binfo\b|^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/i.test(line)).length >=
      Math.min(4, lines.length);
  return looksLikeLogs ? lines.slice(-140) : null;
}

export function sanitizeSecrets(rawValue: string): string {
  let value = normalizeText(rawValue);
  if (!value) return '';

  value = value.replace(
    /(authorization\s*:\s*bearer\s+)([A-Za-z0-9._-]+)/gi,
    '$1[REDACTED]'
  );
  value = value.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT_REDACTED]');
  value = value.replace(
    /(https?:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi,
    '$1[REDACTED]$3'
  );
  value = value.replace(
    /\b([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*\s*=\s*)([^\s"'`]+)/gi,
    '$1[REDACTED]'
  );
  value = value.replace(
    /(\b(--password|--token|--api-key|--apikey)\s+)([^\s]+)/gi,
    '$1[REDACTED]'
  );
  value = value.replace(
    /([?&](token|apikey|api_key|access_token|auth|password)=)([^&\s]+)/gi,
    '$1[REDACTED]'
  );
  value = value.replace(
    /("?(token|secret|password|api[_-]?key|access[_-]?token)"?\s*:\s*")([^"]+)(")/gi,
    '$1[REDACTED]$4'
  );
  return value;
}

export function extractUrls(rawValue: string): string[] {
  const matches = String(rawValue || '').match(/https?:\/\/[^\s<>"')]+/g) || [];
  return uniqueStrings(matches);
}

export function buildTerminalLiveParsedOutput(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number | null
): TerminalLiveParsedOutput {
  const normalizedCommand = String(command || '').trim();
  const safeStdout = normalizeText(stdout).trim();
  const safeStderr = normalizeText(stderr).trim();
  const combinedText = [safeStdout, safeStderr].filter(Boolean).join('\n');
  const warnings: TerminalLiveWarning[] = [];
  const sections: TerminalLiveSection[] = [];
  const urls = extractUrls(combinedText);

  if (exitCode !== null && exitCode !== 0) {
    warnings.push({
      id: 'exit_code',
      label: `Exit code ${exitCode}`,
      detail: 'El comando termino con codigo distinto de cero.'
    });
  }

  extractWarningLines(safeStderr).forEach((warning) => warnings.push(warning));

  const namedSections = splitNamedSections(safeStdout);
  if (namedSections.length > 0) {
    namedSections.forEach((section) => {
      const docker = detectDockerPs(section.body);
      if (docker) {
        sections.push({ kind: 'docker_ps', title: section.title, containers: docker });
        return;
      }
      const disk = detectDfH(section.body);
      if (disk) {
        sections.push({ kind: 'df_h', title: section.title, mounts: disk });
        return;
      }
      const memory = detectFreeH(section.body);
      if (memory) {
        sections.push({ kind: 'free_h', title: section.title, rows: memory });
        return;
      }
      const systemd = detectSystemd(section.body);
      if (systemd) {
        sections.push({ kind: 'systemd', title: section.title, summary: systemd, logs: splitLines(section.body).slice(8) });
        return;
      }
      const journal = detectJournalLike(normalizedCommand, section.body);
      if (journal) {
        sections.push({ kind: 'journal', title: section.title, lines: journal });
        return;
      }
      const jsonBlock = detectJsonBlock(section.body);
      if (jsonBlock) {
        sections.push({ kind: 'json', title: section.title, text: jsonBlock });
        return;
      }
      sections.push({ kind: 'raw', title: section.title, text: section.body, tone: 'stdout' });
    });
  } else if (safeStdout) {
    const docker = detectDockerPs(safeStdout);
    const disk = detectDfH(safeStdout);
    const memory = detectFreeH(safeStdout);
    const systemd = detectSystemd(safeStdout);
    const journal = detectJournalLike(normalizedCommand, safeStdout);
    const jsonBlock = detectJsonBlock(safeStdout);

    if (docker) {
      sections.push({ kind: 'docker_ps', title: 'Docker', containers: docker });
    } else if (disk) {
      sections.push({ kind: 'df_h', title: 'Disco', mounts: disk });
    } else if (memory) {
      sections.push({ kind: 'free_h', title: 'Memoria', rows: memory });
    } else if (systemd) {
      sections.push({ kind: 'systemd', title: 'systemd', summary: systemd, logs: splitLines(safeStdout).slice(8) });
    } else if (jsonBlock) {
      sections.push({ kind: 'json', title: 'JSON', text: jsonBlock });
    } else if (journal) {
      sections.push({ kind: 'journal', title: 'Logs', lines: journal });
    } else {
      sections.push({ kind: 'raw', title: 'stdout', text: safeStdout, tone: 'stdout' });
    }
  }

  if (safeStderr) {
    const stderrJournal = detectJournalLike(normalizedCommand, safeStderr);
    if (stderrJournal) {
      sections.push({ kind: 'journal', title: 'stderr', lines: stderrJournal });
    } else {
      sections.push({ kind: 'raw', title: 'stderr', text: safeStderr, tone: 'stderr' });
    }
  }

  if (sections.length === 0 && combinedText) {
    sections.push({ kind: 'raw', title: 'Salida', text: combinedText, tone: 'mixed' });
  }

  const uniqueWarnings = Array.from(
    new Map(
      warnings.map((warning) => [`${warning.id}:${warning.label}`, warning])
    ).values()
  );

  const summaryParts: string[] = [];
  if (sections.some((section) => section.kind === 'docker_ps')) summaryParts.push('docker');
  if (sections.some((section) => section.kind === 'df_h')) summaryParts.push('disco');
  if (sections.some((section) => section.kind === 'free_h')) summaryParts.push('memoria');
  if (sections.some((section) => section.kind === 'systemd')) summaryParts.push('systemd');
  if (sections.some((section) => section.kind === 'journal')) summaryParts.push('logs');
  if (sections.some((section) => section.kind === 'json')) summaryParts.push('json');

  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : sections.length > 0 ? 'salida estructurada' : 'sin salida';
  return {
    sections,
    urls,
    warnings: uniqueWarnings,
    summary
  };
}

function toMarkdownTable(headers: string[], rows: string[][]): string {
  const safeHeaders = headers.map((entry) => entry || '-');
  const safeRows = rows.map((row) => safeHeaders.map((_header, index) => row[index] || ''));
  return [
    `| ${safeHeaders.join(' | ')} |`,
    `| ${safeHeaders.map(() => '---').join(' | ')} |`,
    ...safeRows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}

export function buildChatGPTDiagnosticExport(
  session: TerminalLiveExportSession,
  options?: { maskSecrets?: boolean }
): string {
  const maskSecrets = options?.maskSecrets !== false;
  const redact = (value: string) => (maskSecrets ? sanitizeSecrets(value) : normalizeText(value));
  const parsed =
    session.parsed ||
    buildTerminalLiveParsedOutput(session.command, session.stdout, session.stderr, session.exitCode);
  const warningLines = uniqueStrings(
    [...(session.warnings || []), ...parsed.warnings]
      .map((warning) => String(warning.detail || warning.label || '').trim())
      .filter(Boolean)
  );

  const parts: string[] = [
    '# Terminal Live diagnostic',
    '',
    `- State: ${session.state}`,
    `- Exit code: ${session.exitCode === null ? 'n/a' : session.exitCode}`,
    `- Duration: ${formatDurationMs(session.durationMs)}`,
    `- Started at: ${session.startedAt || 'n/a'}`,
    `- Finished at: ${session.finishedAt || 'n/a'}`,
    '',
    '## Command',
    '```bash',
    redact(session.command),
    '```'
  ];

  if (warningLines.length > 0) {
    parts.push('', '## Warnings', ...warningLines.map((line) => `- ${redact(line)}`));
  }

  if (parsed.sections.length > 0) {
    parts.push('', '## Parsed output');
    parsed.sections.forEach((section) => {
      parts.push('', `### ${section.title}`);
      if (section.kind === 'docker_ps') {
        parts.push(
          toMarkdownTable(
            ['Name', 'Image', 'Status', 'Ports', 'Container ID'],
            section.containers.map((entry) => [
              redact(entry.names),
              redact(entry.image),
              redact(entry.status),
              redact(entry.ports || '-'),
              redact(entry.containerId)
            ])
          )
        );
        return;
      }
      if (section.kind === 'df_h') {
        parts.push(
          toMarkdownTable(
            ['Mount', 'Filesystem', 'Size', 'Used', 'Avail', 'Use%'],
            section.mounts.map((entry) => [
              redact(entry.mountedOn),
              redact(entry.filesystem),
              redact(entry.size),
              redact(entry.used),
              redact(entry.avail),
              redact(entry.use)
            ])
          )
        );
        return;
      }
      if (section.kind === 'free_h') {
        parts.push(
          toMarkdownTable(
            ['Type', 'Total', 'Used', 'Free', 'Shared', 'Buff/Cache', 'Available'],
            section.rows.map((entry) => [
              redact(entry.label),
              redact(entry.total),
              redact(entry.used),
              redact(entry.free),
              redact(entry.shared || '-'),
              redact(entry.buffCache || '-'),
              redact(entry.available || '-')
            ])
          )
        );
        return;
      }
      if (section.kind === 'systemd') {
        const details = [
          ['Headline', section.summary.headline],
          ['Loaded', section.summary.loaded || '-'],
          ['Active', section.summary.active || '-'],
          ['Main PID', section.summary.mainPid || '-'],
          ['Tasks', section.summary.tasks || '-'],
          ['Memory', section.summary.memory || '-'],
          ['CPU', section.summary.cpu || '-']
        ];
        parts.push(toMarkdownTable(['Field', 'Value'], details.map(([label, value]) => [label, redact(value)])));
        if (section.logs.length > 0) {
          parts.push('', '```text', redact(section.logs.join('\n')), '```');
        }
        return;
      }
      if (section.kind === 'journal') {
        parts.push('```text', redact(section.lines.join('\n')), '```');
        return;
      }
      if (section.kind === 'json') {
        parts.push('```json', redact(section.text), '```');
        return;
      }
      parts.push('```text', redact(section.text), '```');
    });
  }

  const rawStdout = redact(session.stdout || '');
  const rawStderr = redact(session.stderr || '');
  if (rawStdout) {
    parts.push('', '## Raw stdout', '```text', rawStdout, '```');
  }
  if (rawStderr) {
    parts.push('', '## Raw stderr', '```text', rawStderr, '```');
  }

  return parts.join('\n').trim();
}
