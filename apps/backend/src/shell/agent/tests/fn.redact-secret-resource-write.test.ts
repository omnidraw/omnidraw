import { describe, expect, test } from 'bun:test';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { fnRedactSecretResourceWriteMessage } from '../tools/fn.redact-secret-resource-write';

type TAgentMessage = Extract<AgentSessionEvent, { type: 'message_end' }>['message'];

describe('fnRedactSecretResourceWriteMessage', () => {
  test('captures exact arguments while redacting only secret set values from the persisted message', () => {
    const message = {
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'call-1',
        name: 'od_resource_data_write',
        arguments: {
          resourceName: 'Credentials',
          operations: [
            { operation: 'set', key: 'TOKEN', value: 'plaintext-secret' },
            { operation: 'delete', key: 'OLD_TOKEN' },
          ],
        },
      }],
    } as unknown as TAgentMessage;

    const result = fnRedactSecretResourceWriteMessage(message);

    expect(result.captured).toEqual([{ toolCallId: 'call-1', args: {
      resourceName: 'Credentials',
      operations: [
        { operation: 'set', key: 'TOKEN', value: 'plaintext-secret' },
        { operation: 'delete', key: 'OLD_TOKEN' },
      ],
    } }]);
    expect(JSON.stringify(result.message)).not.toContain('plaintext-secret');
    expect(JSON.stringify(result.message)).toContain('[redacted]');
    expect(JSON.stringify(message)).toContain('plaintext-secret');
  });
});
