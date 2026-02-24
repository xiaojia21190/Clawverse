import Hyperswarm from 'hyperswarm';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { encode, decode, IClawverseMessage } from '@clawverse/protocol';
import { PeerInfo } from '@clawverse/types';
import { logger } from './logger.js';
import { loadSecurityConfig } from './security.js';
import { encodeLengthPrefixedFrame, readLengthPrefixedFrame } from './network-framing.js';

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
  private readonly allowedPeers: Set<string>;
  private readonly maxMsgsPer10s: number;
  private readonly maxFrameBytes: number;
  private readonly ingressStats: Map<string, { windowStart: number; count: number }> = new Map();
  private readonly ingressBuffers: Map<string, Buffer> = new Map();
  private readonly ingressProcessing: Set<string> = new Set();
  private readonly ingressDirty: Set<string> = new Set();
  private readonly sharedSecret: string;
  private readonly requireSignedIngress: boolean;

  constructor(topic: string) {
    super();
    this.topicName = topic;
    this.topic = crypto.createHash('sha256').update(topic).digest();

    const sec = loadSecurityConfig();

    this.allowedPeers = new Set(sec.allowedPeers || []);

    this.maxMsgsPer10s = Math.max(1, Number(sec.maxMsgsPer10s || 200));
    const frameLimitRaw = Number(process.env.CLAWVERSE_MAX_FRAME_BYTES || 8 * 1024 * 1024);
    this.maxFrameBytes =
      Number.isFinite(frameLimitRaw) && frameLimitRaw >= 1024
        ? Math.floor(frameLimitRaw)
        : 8 * 1024 * 1024;
    this.sharedSecret = sec.sharedSecret || '';
    this.requireSignedIngress = !!sec.requireSignedIngress;

    if (this.allowedPeers.size > 0) {
      logger.network(`Peer allowlist enabled (${this.allowedPeers.size} peers)`);
    }
    logger.network(`Ingress rate limit: ${this.maxMsgsPer10s} msgs/10s per peer`);
    logger.network(`Frame size limit: ${this.maxFrameBytes} bytes`);
    if (this.sharedSecret) {
      logger.network('Message signing enabled (shared secret)');
    }
    if (this.requireSignedIngress) {
      logger.network('Unsigned ingress messages will be rejected');
    }
  }

  private isAllowedPeer(peerId: string): boolean {
    if (this.allowedPeers.size === 0) return true;
    return this.allowedPeers.has(peerId);
  }

  private allowIngress(peerId: string): boolean {
    const now = Date.now();
    const slot = this.ingressStats.get(peerId);

    if (!slot || now - slot.windowStart >= 10_000) {
      this.ingressStats.set(peerId, { windowStart: now, count: 1 });
      return true;
    }

    slot.count += 1;
    if (slot.count > this.maxMsgsPer10s) {
      return false;
    }
    return true;
  }

  private signBody(body: Uint8Array): string {
    return crypto
      .createHmac('sha256', this.sharedSecret)
      .update(Buffer.from(body))
      .digest('hex');
  }

  private encodeWire(body: Uint8Array): Buffer {
    if (!this.sharedSecret) return Buffer.from(body);
    const envelope = {
      v: 1,
      alg: 'hmac-sha256',
      sig: this.signBody(body),
      body: Buffer.from(body).toString('base64'),
    };
    return Buffer.from(`CV1:${JSON.stringify(envelope)}`, 'utf8');
  }

  private decodeWire(peerId: string, data: Buffer): Uint8Array | null {
    const asText = data.toString('utf8');

    if (!asText.startsWith('CV1:')) {
      if (this.requireSignedIngress && this.sharedSecret) {
        logger.warn(`Rejected unsigned message from ${peerId}`);
        return null;
      }
      return new Uint8Array(data);
    }

    try {
      const parsed = JSON.parse(asText.slice(4)) as { sig: string; body: string };
      const body = Buffer.from(parsed.body, 'base64');
      if (!this.sharedSecret) {
        return new Uint8Array(body);
      }
      const expected = this.signBody(new Uint8Array(body));
      if (parsed.sig !== expected) {
        logger.warn(`Rejected bad signature from ${peerId}`);
        return null;
      }
      return new Uint8Array(body);
    } catch {
      logger.warn(`Rejected malformed signed envelope from ${peerId}`);
      return null;
    }
  }

  private frameWire(payload: Buffer): Buffer {
    return encodeLengthPrefixedFrame(payload, this.maxFrameBytes);
  }

  private enqueueIngress(
    peerId: string,
    info: PeerInfo,
    socket: HyperswarmSocket,
    chunk: Buffer,
  ): void {
    const previous = this.ingressBuffers.get(peerId) ?? Buffer.alloc(0);
    this.ingressBuffers.set(peerId, Buffer.concat([previous, chunk]));
    if (this.ingressProcessing.has(peerId)) {
      this.ingressDirty.add(peerId);
      return;
    }

    this.ingressProcessing.add(peerId);
    void this.processIngress(peerId, info, socket).finally(() => {
      this.ingressProcessing.delete(peerId);
      if (this.ingressDirty.delete(peerId) && this.peers.has(peerId)) {
        this.enqueueIngress(peerId, info, socket, Buffer.alloc(0));
        return;
      }
      const rest = this.ingressBuffers.get(peerId);
      if (rest && rest.length === 0) this.ingressBuffers.delete(peerId);
    });
  }

  private async processIngress(
    peerId: string,
    info: PeerInfo,
    socket: HyperswarmSocket,
  ): Promise<void> {
    while (true) {
      const buffered = this.ingressBuffers.get(peerId);
      if (!buffered) return;

      const frameRead = readLengthPrefixedFrame(buffered, this.maxFrameBytes);
      if (frameRead.invalidLength !== undefined) {
        logger.warn(`Rejected invalid frame from ${peerId} (len=${frameRead.invalidLength})`);
        this.ingressBuffers.delete(peerId);
        socket.end();
        return;
      }
      if (frameRead.needsMore || !frameRead.frame) return;

      this.ingressBuffers.set(peerId, frameRead.rest);
      const frame = frameRead.frame;

      if (!this.allowIngress(peerId)) {
        logger.warn(`Rate-limited peer: ${peerId}`);
        continue;
      }

      try {
        const body = this.decodeWire(peerId, frame);
        if (!body) continue;
        const message = await decode(body);
        info.lastSeen = new Date();
        this.emit('message', peerId, message);
      } catch (err) {
        logger.error(`Failed to decode message from ${peerId}:`, err);
      }
    }
  }

  async start(): Promise<string> {
    logger.network('Starting Hyperswarm...');

    this.swarm = new Hyperswarm();
    this.myId = this.swarm.keyPair.publicKey.toString('hex').slice(0, 16);

    logger.network(`My Peer ID: ${this.myId}`);
    logger.network(`Topic: ${this.topicName}`);

    this.swarm.on('connection', (socket: HyperswarmSocket) => {
      const peerId = socket.remotePublicKey.toString('hex').slice(0, 16);

      if (!this.isAllowedPeer(peerId)) {
        logger.warn(`Blocked non-allowlisted peer: ${peerId}`);
        socket.end();
        return;
      }

      logger.peer(`Connected: ${peerId}`);

      const info: PeerInfo = {
        id: peerId,
        name: peerId.slice(0, 8),
        connectedAt: new Date(),
        lastSeen: new Date(),
      };

      this.peers.set(peerId, { socket, info });
      this.ingressBuffers.set(peerId, Buffer.alloc(0));
      this.emit('peer:connect', info);

      // Handle incoming data
      socket.on('data', (data: Buffer) => {
        this.enqueueIngress(peerId, info, socket, data);
      });

      // Handle errors
      socket.on('error', (err: Error) => {
        logger.error(`Socket error with ${peerId}:`, (err as Error).message);
      });

      // Handle disconnect
      socket.on('close', () => {
        logger.peer(`Disconnected: ${peerId}`);
        this.peers.delete(peerId);
        this.ingressStats.delete(peerId);
        this.ingressBuffers.delete(peerId);
        this.ingressProcessing.delete(peerId);
        this.ingressDirty.delete(peerId);
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
      this.ingressStats.clear();
      this.ingressBuffers.clear();
      this.ingressProcessing.clear();
      this.ingressDirty.clear();
      logger.network('Hyperswarm stopped');
    }
  }

  async broadcast(message: IClawverseMessage): Promise<void> {
    const data = await encode(message);
    const buffer = this.frameWire(this.encodeWire(data));

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
      peer.socket.write(this.frameWire(this.encodeWire(data)));
      return true;
    } catch (err) {
      logger.error(`Failed to send to ${peerId}:`, err);
      return false;
    }
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map((p) => p.info);
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  getMyId(): string {
    return this.myId;
  }
}
