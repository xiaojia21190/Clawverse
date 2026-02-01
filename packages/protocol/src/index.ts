export * from './generated.js';
import { getRoot, IClawverseMessage, IHeartbeat, IPeerAnnounce, IYjsSync, IPrivateMessage } from './generated.js';
import protobuf from 'protobufjs';

let ClawverseMessage: protobuf.Type | null = null;

async function getMessageType(): Promise<protobuf.Type> {
  if (!ClawverseMessage) {
    const root = await getRoot();
    ClawverseMessage = root.lookupType('clawverse.ClawverseMessage');
  }
  return ClawverseMessage;
}

export const PROTOCOL_VERSION = 1;

export async function encode(message: IClawverseMessage): Promise<Uint8Array> {
  const MessageType = await getMessageType();
  const errMsg = MessageType.verify(message);
  if (errMsg) throw new Error(errMsg);
  const msg = MessageType.create(message);
  return MessageType.encode(msg).finish();
}

export async function decode(buffer: Uint8Array): Promise<IClawverseMessage> {
  const MessageType = await getMessageType();
  const message = MessageType.decode(buffer);
  return MessageType.toObject(message, {
    longs: Number,
    defaults: true,
  }) as IClawverseMessage;
}

export function createHeartbeat(data: Omit<IHeartbeat, 'timestamp'>): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    heartbeat: {
      ...data,
      timestamp: Date.now(),
    },
  };
}

export function createAnnounce(data: IPeerAnnounce): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    announce: data,
  };
}

export function createYjsSync(update: Uint8Array): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    yjsSync: { update },
  };
}

export function createPrivateMessage(from: string, to: string, content: string): IClawverseMessage {
  return {
    version: PROTOCOL_VERSION,
    privateMsg: { from, to, content },
  };
}
