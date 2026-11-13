const SECRET_NAME =
  /authorization|token|secret|password|passwd|api[-_]?key|bearer|cookie|private[-_]?key/i;

export function findSecretFields(definition: unknown): string[] {
  if (!definition || typeof definition !== 'object') return [];
  const record = definition as Record<string, unknown>;
  const hits: string[] = [];
  if (Array.isArray(record.tools)) {
    record.tools.forEach((tool, index) => {
      walk((tool as { input?: unknown } | null)?.input, `tools[${index}].input`, hits);
    });
  }
  if (record.trigger && typeof record.trigger === 'object') {
    walk((record.trigger as { input?: unknown }).input, 'trigger.input', hits);
  }
  if (Array.isArray(record.steps)) {
    record.steps.forEach((step, index) => walkStep(step, `steps[${index}]`, hits));
  }
  if (Array.isArray(record.nodes)) {
    record.nodes.forEach((node, index) => {
      walk((node as { value?: unknown } | null)?.value, `nodes[${index}].value`, hits);
    });
  }
  return hits;
}

function walkStep(step: unknown, path: string, hits: string[]): void {
  if (!step || typeof step !== 'object') return;
  const record = step as { input?: unknown; paths?: Array<{ steps?: unknown[] }> };
  walk(record.input, `${path}.input`, hits);
  record.paths?.forEach((pathDef, index) => {
    pathDef?.steps?.forEach((nested, stepIndex) => {
      walkStep(nested, `${path}.paths[${index}].steps[${stepIndex}]`, hits);
    });
  });
}

function walk(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      typeof child === 'string' &&
      child.trim() &&
      SECRET_NAME.test(key) &&
      !child.includes('={{')
    ) {
      hits.push(childPath);
    } else {
      walk(child, childPath, hits);
    }
  }
}

export function redactSecrets(text: string): string {
  return text.replace(
    /("(?:\\.|[^"\\])*(?:authorization|token|secret|password|passwd|api[-_]?key|bearer|cookie|private[-_]?key)(?:\\.|[^"\\])*")(\s*:\s*)"((?:\\.|[^"\\])*)"/gi,
    (match, key: string, colon: string, value: string) =>
      value.includes('={{') ? match : `${key}${colon}"***"`,
  );
}

/**
 * Line diff. O(n*m) LCS.
 * ponytail: definition files are small; switch to a linear diff past ~1000 lines.
 */
export function lineDiff(local: string, server: string): string {
  const a = local.split('\n');
  const b = server.split('\n');
  if (a.length * b.length > 1_000_000) {
    const lines = a.map((line) => `-${line}`);
    lines.push('---');
    lines.push(...b.map((line) => `+${line}`));
    return lines.join('\n');
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`-${a[i]}`);
      i += 1;
    } else {
      out.push(`+${b[j]}`);
      j += 1;
    }
  }
  while (i < a.length) out.push(`-${a[i++]}`);
  while (j < b.length) out.push(`+${b[j++]}`);
  return out.join('\n');
}

export function formatConflict(label: string, local: string, server: string): string {
  return `${label}\n--- local\n+++ server\n${lineDiff(redactSecrets(local), redactSecrets(server))}`;
}
