import { EventEmitter } from 'events';
import { Tool } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BusMessageType =
  | 'contribution'
  | 'request'
  | 'feedback'
  | 'vote'
  | 'file_change'
  | 'error_report'
  | 'status_update'
  | 'plan';

export interface BusPayload {
  summary: string;
  content: string;
  files?: string[];
  metadata?: Record<string, unknown>;
}

export interface BusMessage {
  id: string;
  swarmId: string;
  fromAgentId: string;
  fromRole: string;
  type: BusMessageType;
  target: string; // agentId, role, or '*' for broadcast
  payload: BusPayload;
  timestamp: number;
  round?: number;
}

// ---------------------------------------------------------------------------
// ContextBus — shared pub-sub message bus for swarm agents
// ---------------------------------------------------------------------------

export class ContextBus {
  private readonly swarmId: string;
  private readonly maxMessages: number;
  private readonly emitter: EventEmitter;
  private messages: BusMessage[] = [];
  private counter = 0;

  constructor(swarmId: string, maxMessages = 500) {
    this.swarmId = swarmId;
    this.maxMessages = maxMessages;
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  /**
   * Post a message to the bus. Returns the fully-populated BusMessage
   * (with generated id and timestamp).
   */
  post(message: Omit<BusMessage, 'id' | 'timestamp' | 'swarmId'>): BusMessage {
    this.counter++;
    const full: BusMessage = {
      ...message,
      id: `msg_${this.swarmId}_${this.counter}_${Date.now()}`,
      swarmId: this.swarmId,
      timestamp: Date.now(),
    };

    this.messages.push(full);

    // Evict oldest messages when we exceed the cap
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxMessages);
    }

    // Emit on the general channel
    this.emitter.emit('message', full);

    // Emit on targeted channels
    if (full.target && full.target !== '*') {
      this.emitter.emit(`agent:${full.target}`, full);
      this.emitter.emit(`role:${full.target}`, full);
    }

    return full;
  }

  /**
   * Subscribe to messages relevant to a specific agent. The callback will
   * fire for broadcast messages and messages targeted at this agent's id or
   * role. Own messages (fromAgentId === agentId) are skipped.
   *
   * Returns an unsubscribe function.
   */
  subscribe(
    agentId: string,
    role: string,
    callback: (msg: BusMessage) => void,
  ): () => void {
    const handler = (msg: BusMessage) => {
      // Skip own messages
      if (msg.fromAgentId === agentId) return;

      // Deliver if broadcast, or targeted at this agent/role
      if (msg.target === '*' || msg.target === agentId || msg.target === role) {
        callback(msg);
      }
    };

    this.emitter.on('message', handler);

    return () => {
      this.emitter.off('message', handler);
    };
  }

  /**
   * Build a formatted markdown context string containing all messages visible
   * to this agent (broadcast, or targeted at agentId / role). Returns the
   * most recent `maxMessages` entries.
   */
  getContextForAgent(agentId: string, role: string, maxMessages = 50): string {
    const visible = this.messages.filter(
      (m) => m.target === '*' || m.target === agentId || m.target === role,
    );

    const recent = visible.slice(-maxMessages);

    if (recent.length === 0) return '';

    const lines: string[] = ['# Swarm Context Bus\n'];

    for (const msg of recent) {
      const time = new Date(msg.timestamp).toISOString();
      lines.push(`### [${msg.type.toUpperCase()}] from ${msg.fromRole} (${msg.fromAgentId})`);
      lines.push(`_Target: ${msg.target} | Time: ${time}${msg.round !== undefined ? ` | Round: ${msg.round}` : ''}_\n`);
      lines.push(`**${msg.payload.summary}**\n`);
      lines.push(msg.payload.content);
      if (msg.payload.files && msg.payload.files.length > 0) {
        lines.push(`\nFiles: ${msg.payload.files.join(', ')}`);
      }
      if (msg.payload.metadata) {
        lines.push(`\nMetadata: ${JSON.stringify(msg.payload.metadata)}`);
      }
      lines.push('\n---\n');
    }

    return lines.join('\n');
  }

  /** Filter messages by type and optional round. */
  getByType(type: BusMessageType, round?: number): BusMessage[] {
    return this.messages.filter(
      (m) => m.type === type && (round === undefined || m.round === round),
    );
  }

  /** Filter messages by the sender's role. */
  getByRole(role: string): BusMessage[] {
    return this.messages.filter((m) => m.fromRole === role);
  }

  /** Return the total number of messages currently stored. */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** Return a shallow copy of all stored messages. */
  getAllMessages(): BusMessage[] {
    return [...this.messages];
  }

  /** Remove all messages from the bus. */
  clear(): void {
    this.messages = [];
  }
}

// ---------------------------------------------------------------------------
// BusBridgeTool — injected into each swarm agent's tool registry so they
// can interact with the shared context bus.
// ---------------------------------------------------------------------------

export class BusBridgeTool implements Tool {
  name = 'swarm_bus';
  description =
    'Post updates or read context from other agents in the swarm. Actions: post (share findings), read (get updates), vote (cast vote on proposal).';
  permission = 'auto' as Tool['permission'];

  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: 'The action to perform: post, read, or vote.',
      },
      summary: {
        type: 'string',
        description: 'Short summary of the message (used with post and vote).',
      },
      content: {
        type: 'string',
        description: 'Detailed content of the message (used with post).',
      },
      target: {
        type: 'string',
        description:
          'Target agent id, role name, or "*" for broadcast. Defaults to "*".',
        default: '*',
      },
      vote: {
        type: 'string',
        description: 'Vote value: approve, reject, or abstain (used with vote action).',
        enum: ['approve', 'reject', 'abstain'],
      },
      reason: {
        type: 'string',
        description: 'Reason for the vote (used with vote action).',
      },
    },
    required: ['action'],
  };

  private readonly bus: ContextBus;
  private readonly agentId: string;
  private readonly role: string;

  constructor(bus: ContextBus, agentId: string, role: string) {
    this.bus = bus;
    this.agentId = agentId;
    this.role = role;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const action = params.action as string;
    const target = (params.target as string) || '*';

    switch (action) {
      case 'post': {
        const summary = (params.summary as string) || 'Update';
        const content = (params.content as string) || '';
        const posted = this.bus.post({
          fromAgentId: this.agentId,
          fromRole: this.role,
          type: 'contribution',
          target,
          payload: { summary, content },
        });
        return `Message posted to bus (id: ${posted.id}, target: ${target}).`;
      }

      case 'read': {
        const context = this.bus.getContextForAgent(this.agentId, this.role);
        return context || 'No messages yet.';
      }

      case 'vote': {
        const voteSummary = (params.summary as string) || 'Vote';
        const voteValue = (params.vote as string) || 'abstain';
        const reason = (params.reason as string) || '';
        const voteMsg = this.bus.post({
          fromAgentId: this.agentId,
          fromRole: this.role,
          type: 'vote',
          target,
          payload: {
            summary: voteSummary,
            content: reason,
            metadata: { vote: voteValue, reason },
          },
        });
        return `Vote "${voteValue}" posted to bus (id: ${voteMsg.id}).`;
      }

      default:
        return `Unknown action "${action}". Supported actions: post, read, vote.`;
    }
  }
}
