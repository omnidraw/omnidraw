import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

type TAgentMessage = Extract<AgentSessionEvent, { type: 'message_end' }>['message'];

export type TCapturedSensitiveToolArgs = {
  toolCallId: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSecretSetOperation(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.kind === 'secretStore'
    && value.operation === 'set'
    && typeof value.value === 'string';
}

function containsSecretSet(args: Record<string, unknown>): boolean {
  const operations = Array.isArray(args.operation) ? args.operation : [args.operation];
  return operations.some(isSecretSetOperation);
}

function redactOperation(value: unknown): unknown {
  return isSecretSetOperation(value) ? { ...value, value: '[redacted]' } : value;
}

export function fnRedactSecretResourceWriteMessage(message: TAgentMessage): {
  message: TAgentMessage;
  captured: TCapturedSensitiveToolArgs[];
} {
  if (message.role !== 'assistant') return { message, captured: [] };

  const captured: TCapturedSensitiveToolArgs[] = [];
  const content = message.content.map((block) => {
    if (block.type !== 'toolCall' || block.name !== 'vc_resource_data_write' || !containsSecretSet(block.arguments)) {
      return block;
    }
    captured.push({ toolCallId: block.id, args: block.arguments });
    const operation = Array.isArray(block.arguments.operation)
      ? block.arguments.operation.map(redactOperation)
      : redactOperation(block.arguments.operation);
    return { ...block, arguments: { ...block.arguments, operation } };
  });

  return captured.length === 0 ? { message, captured } : { message: { ...message, content }, captured };
}
