import Hyperswarm from 'hyperswarm';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { encode, decode, IClawverseMessage } from '@clawverse/protocol';
import { PeerInfo } from '@clawverse/types';
import { logger } from './logger.js';

interface HyperswarmSocket extends EventEmitter {
  remotePublicKey: Buffer;
  write(data: Buffer): boolean;
  end(): void;
}

export interface NetworkEvents {
  'peer:connect': (peer: PeerInfo) => void;
  'peer:disconnect': (peerId: string) => void;
  'message': (peerId: string, message: IClawverseMessage) => void;
}

export declare interface ClawverseNetwork {
  on<K extends keyof NetworkEvents>(event: K, listener: NetworkEvents[K]): this;
  emit<K extends keyof NetworkEvents>(event: K, ...args: Parameters<NetworkEvents[K]>): boolean;
}

export class ClawverseNetwork extends EventEmitter {
  private swarm: Hyperswarm | null = null;
  private topic: Buffer;
  private topicName: string;
  private peers: Map<string, { socket: HyperswarmSocket; info: PeerInfo }> = new Map();
  private myId: string = '';

  constructor(topic: string) {
    super();
    this.topicName = topic;
    this.topic = crypto.createHash('sha256').update(topic).digest();
  }

  async start(): Promise<string> {
    logger.network('Starting Hyperswarm...');

    this.swarm = new Hyperswarm();
    this.myId = this.swarm.keyPair.publicKey.toString('hex').slice(0, 16);

    logger.network(`My Peer ID: ${this.myId}`);
    logger.network(`Topic: ${this.topicName}`);

    this.swarm.on('connection', (socket: HyperswarmSocket) => {
      const peerId = socket.remotePublicKey.toString('hex').slice(0, 16);
      logger.peer(`Connected: ${peerId}`);

      const info: PeerInfo = {
        id: peerId,
        name: peerId.slice(0, 8),
        connectedAt: new Date(),
        lastSeen: new Date(),
      };

      this.peers.set(peerId, { socket, info });
      this.emit('peer:connect', info);

      // Handle incoming data
      socket.on('data', async (data: Buffer) => {
        try {
          const message = await decode(new Uint8Array(data));
          info.lastSeen = new Date();
          this.emit('message', peerId, message);
        } catch (err) {
          logger.error(`Failed to decode message from ${peerId}:`, err);
        }
      });

      // Handle errors
      socket.on('error', (err: Error) => {
        logger.error(`Socket error with ${peerId}:`, (err as Error).message);
      });

      // Handle disconnect
      socket.on('close', () => {
        logger.peer(`Disconnected: ${peerId}`);
        this.peers.delete(peerId);
        this.emit('peer:disconnect', peerId);
      });
    });

    // Join the topic
    const discovery = this.swarm.join(this.topic, { client: true, server: true });
    await discovery.flushed();

    logger.network('Joined topic, waiting for peers...');

    return this.myId;
  }

  async stop(): Promise<void> {
    if (this.swarm) {
      logger.network('Stopping Hyperswarm...');
      await this.swarm.destroy();
      this.swarm = null;
      this.peers.clear();
      logger.network('Hyperswarm stopped');
    }
  }

  async broadcast(message: IClawverseMessage): Promise<void> {
    const data = await encode(message);
    const buffer = Buffer.from(data);

    for (const [peerId, { socket }] of this.peers) {
      try {
        socket.write(buffer);
      } catch (err) {
        logger.error(`Failed to send to ${peerId}:`, err);
      }
    }
  }

  async sendTo(peerId: string, message: IClawverseMessage): Promise<boolean> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      logger.warn(`Peer not found: ${peerId}`);
      return false;
    }

    try {
      const data = await encode(message);
      peer.socket.write(Buffer.from(data));
      return true;
    } catch (err) {
      logger.error(`Failed to send to ${peerId}:`, err);
      return false;
    }
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map(p => p.info);
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  getMyId(): string {
    return this.myId;
  }
}
