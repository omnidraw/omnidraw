import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

type TAgentMessage = Extract<AgentSessionEvent, { type: 'message_end' }>['message'];

export type TCapturedSensitiveToolArgs = {
  toolCallId: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveSetOperation(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.operation === 'set'
    && 'value' in value;
}

function containsSecretSet(args: Record<string, unknown>): boolean {
  const operations = Array.isArray(args.operations) ? args.operations : [];
  return operations.some(isSensitiveSetOperation);
}

function redactOperation(value: unknown): unknown {
  return isSensitiveSetOperation(value) ? { ...value, value: '[redacted]' } : value;
}

export function fnRedactSecretResourceWriteMessage(message: TAgentMessage): {
  message: TAgentMessage;
  captured: TCapturedSensitiveToolArgs[];
} {
  if (message.role !== 'assistant') return { message, captured: [] };

  const captured: TCapturedSensitiveToolArgs[] = [];
  const content = message.content.map((block) => {
    if (block.type !== 'toolCall' || block.name !== 'od_resource_data_write' || !containsSecretSet(block.arguments)) {
      return block;
    }
    captured.push({ toolCallId: block.id, args: block.arguments });
    const operations = Array.isArray(block.arguments.operations)
      ? block.arguments.operations.map(redactOperation)
      : [];
    return { ...block, arguments: { ...block.arguments, operations } };
  });

  return captured.length === 0 ? { message, captured } : { message: { ...message, content }, captured };
}
