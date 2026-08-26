/**
 * Catalogue flattening / filtering for the CLI tools and apps commands.
 * Action shapes are loosely typed (OpenAPI additionalProperties).
 */

export interface CatalogApp {
  id?: string;
  name?: string;
  description?: string;
  isPublished?: boolean;
  needsConnection?: boolean;
  availableForAgent?: boolean;
  actions?: unknown[];
  triggers?: unknown[];
  connections?: unknown[];
}

export interface CatalogActionRecord {
  id?: string;
  name?: string;
  description?: string;
  needsConnection?: boolean;
  availableForAgent?: boolean;
  inputConfig?: unknown;
  [key: string]: unknown;
}

export interface CatalogAction {
  appId: string;
  appName: string;
  actionId: string;
  name: string;
  description: string;
  availableForAgent: boolean;
  needsConnection: boolean;
  inputConfig?: unknown;
}

export interface InputFieldSummary {
  id: string;
  label?: string;
  type?: string;
  required?: boolean;
}

export interface CatalogFilter {
  appId?: string;
  forAgent?: boolean;
  query?: string;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function flattenActions(apps: CatalogApp[]): CatalogAction[] {
  const out: CatalogAction[] = [];
  for (const app of apps) {
    const appId = typeof app.id === 'string' ? app.id : '';
    if (!appId) {
      continue;
    }
    const actions = Array.isArray(app.actions) ? app.actions : [];
    for (const raw of actions) {
      const action = asRecord(raw);
      if (!action || typeof action.id !== 'string' || !action.id) {
        continue;
      }
      const actionId = action.id;
      out.push({
        appId,
        appName: typeof app.name === 'string' ? app.name : appId,
        actionId,
        name: typeof action.name === 'string' ? action.name : actionId,
        description:
          typeof action.description === 'string' ? action.description : '',
        availableForAgent:
          typeof action.availableForAgent === 'boolean'
            ? action.availableForAgent
            : Boolean(app.availableForAgent),
        needsConnection:
          typeof action.needsConnection === 'boolean'
            ? action.needsConnection
            : Boolean(app.needsConnection),
        inputConfig: action.inputConfig,
      });
    }
  }
  return out;
}

export function filterActions(
  actions: CatalogAction[],
  filter: CatalogFilter = {},
): CatalogAction[] {
  const appId = filter.appId?.trim();
  const query = filter.query?.trim().toLowerCase();
  return actions.filter((action) => {
    if (appId && action.appId !== appId) {
      return false;
    }
    if (filter.forAgent && !action.availableForAgent) {
      return false;
    }
    if (query) {
      const haystack = [
        action.appId,
        action.appName,
        action.actionId,
        action.name,
        action.description,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

export function parseActionRef(raw: string): { appId?: string; actionId: string } {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf('.');
  if (dot > 0) {
    const maybeApp = trimmed.slice(0, dot);
    const maybeAction = trimmed.slice(dot + 1);
    if (maybeApp && maybeAction && !maybeApp.includes('_action_')) {
      return { appId: maybeApp, actionId: maybeAction };
    }
  }
  return { actionId: trimmed };
}

export function resolveAction(
  actions: CatalogAction[],
  rawRef: string,
  appId?: string,
): CatalogAction {
  const parsed = parseActionRef(rawRef);
  const scope = appId?.trim() || parsed.appId;
  const matches = actions.filter((action) => {
    if (action.actionId !== parsed.actionId) {
      return false;
    }
    return scope ? action.appId === scope : true;
  });

  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length === 0) {
    const hint = scope
      ? `No action "${parsed.actionId}" on app "${scope}". Try: tools search ${parsed.actionId}`
      : `Unknown action "${parsed.actionId}". Try: tools search ${parsed.actionId}`;
    throw new Error(hint);
  }
  const apps = matches.map((m) => m.appId).join(', ');
  throw new Error(
    `Action "${parsed.actionId}" exists on multiple apps (${apps}). Pass --app <appId>.`,
  );
}

export function extractInputFields(inputConfig: unknown): InputFieldSummary[] {
  if (!inputConfig) {
    return [];
  }
  if (Array.isArray(inputConfig)) {
    return inputConfig
      .map((item) => fieldFromUnknown(item))
      .filter((field): field is InputFieldSummary => Boolean(field));
  }

  const record = asRecord(inputConfig);
  if (!record) {
    return [];
  }

  if (Array.isArray(record.fields)) {
    return extractInputFields(record.fields);
  }

  if (Array.isArray(record.sections)) {
    return record.sections.flatMap((section) => {
      const sectionRecord = asRecord(section);
      return extractInputFields(sectionRecord?.fields ?? section);
    });
  }

  return Object.entries(record)
    .filter(([, value]) => value === null || typeof value !== 'object' || !Array.isArray(value))
    .map(([id, value]) => {
      const field = asRecord(value);
      if (!field) {
        return { id };
      }
      return {
        id: typeof field.id === 'string' ? field.id : id,
        label: typeof field.label === 'string' ? field.label : undefined,
        type:
          typeof field.type === 'string'
            ? field.type
            : typeof field.inputType === 'string'
              ? field.inputType
              : undefined,
        required: typeof field.required === 'boolean' ? field.required : undefined,
      };
    });
}

function fieldFromUnknown(value: unknown): InputFieldSummary | undefined {
  const field = asRecord(value);
  if (!field || typeof field.id !== 'string' || !field.id) {
    return undefined;
  }
  return {
    id: field.id,
    label: typeof field.label === 'string' ? field.label : undefined,
    type:
      typeof field.type === 'string'
        ? field.type
        : typeof field.inputType === 'string'
          ? field.inputType
          : undefined,
    required: typeof field.required === 'boolean' ? field.required : undefined,
  };
}

export function summarizeAction(action: CatalogAction): {
  appId: string;
  actionId: string;
  name: string;
  description: string;
  availableForAgent: boolean;
  needsConnection: boolean;
} {
  return {
    appId: action.appId,
    actionId: action.actionId,
    name: action.name,
    description: action.description,
    availableForAgent: action.availableForAgent,
    needsConnection: action.needsConnection,
  };
}

export function formatDefineActionSnippet(action: CatalogAction): string {
  const fields = extractInputFields(action.inputConfig);
  const inputBlock =
    fields.length === 0
      ? '    // no inputConfig fields advertised'
      : fields
          .map((field) => {
            const notes = [
              field.label && field.label !== field.id ? field.label : undefined,
              field.type,
              field.required ? 'required' : undefined,
            ]
              .filter(Boolean)
              .join(', ');
            return notes
              ? `    // ${field.id}${notes ? ` — ${notes}` : ''}`
              : `    // ${field.id}`;
          })
          .join('\n');

  return [
    'defineAction({',
    `  id: '${action.actionId}',`,
    `  appId: '${action.appId}',`,
    '  input: {',
    inputBlock,
    '  },',
    '})',
  ].join('\n');
}

export function actionDetail(action: CatalogAction): {
  appId: string;
  actionId: string;
  name: string;
  description: string;
  availableForAgent: boolean;
  needsConnection: boolean;
  inputFields: InputFieldSummary[];
  inputConfig: unknown;
  defineAction: string;
} {
  return {
    ...summarizeAction(action),
    inputFields: extractInputFields(action.inputConfig),
    inputConfig: action.inputConfig ?? null,
    defineAction: formatDefineActionSnippet(action),
  };
}
