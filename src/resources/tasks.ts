import type { UIMessage } from 'ai';

import type { HttpClient } from '../core/http';
import type {
  CreateTaskInput,
  DeletedTask,
  Task,
  TaskListItem,
  UpdateTaskInput,
} from '../types';
import type { ChatMode } from '../streaming/agent-chat';
import { serializeListQuery, type ListQueryOptions } from './common';

export class TasksResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists tasks (conversation threads) visible to the caller, most recently updated first. */
  list(options?: ListQueryOptions): Promise<TaskListItem[]> {
    return this.http.get<TaskListItem[]>('/api/tasks', {
      query: serializeListQuery(options),
    });
  }

  /** Returns a single task. Request `expansion: ['messages']` for the conversation history. */
  get(taskId: string, options?: Pick<ListQueryOptions, 'expansion'>): Promise<Task> {
    return this.http.get<Task>(`/api/tasks/${taskId}`, {
      query: serializeListQuery(options),
    });
  }

  /** Creates a task (conversation thread) for an agent. */
  create(
    agentId: string,
    data: CreateTaskInput,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Task> {
    return this.http.post<Task>(`/api/agents/${agentId}/tasks`, {
      body: data,
      query: serializeListQuery(options),
    });
  }

  /** Updates the task name or description. */
  update(
    taskId: string,
    data: UpdateTaskInput,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Task> {
    return this.http.patch<Task>(`/api/tasks/${taskId}`, {
      body: data,
      query: serializeListQuery(options),
    });
  }

  /** Permanently deletes a task and its messages. */
  delete(taskId: string): Promise<DeletedTask> {
    return this.http.delete<DeletedTask>(`/api/tasks/${taskId}`);
  }

  /**
   * Sends a message to an agent task and waits for the full agent turn to
   * finish (non-streaming). Returns either a plain string or the assistant
   * messages in AI SDK UIMessage format. For token-by-token output use
   * `client.agentChat.streamMessage` instead.
   */
  message(
    agentId: string,
    taskId: string,
    message: string | UIMessage,
    options: { chatMode?: ChatMode } = {},
  ): Promise<string | UIMessage[]> {
    const uiMessage: UIMessage =
      typeof message === 'string'
        ? {
            id: generateMessageId(),
            role: 'user',
            parts: [{ type: 'text', text: message }],
          }
        : message;

    return this.http.post<string | UIMessage[]>(
      `/api/agents/${agentId}/tasks/${taskId}/message`,
      {
        body: {
          messages: [uiMessage],
          ...(options.chatMode ? { chatMode: options.chatMode } : {}),
        },
      },
    );
  }
}

function generateMessageId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
