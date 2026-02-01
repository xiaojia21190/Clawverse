declare module 'hyperswarm' {
  import { EventEmitter } from 'node:events';

  interface KeyPair {
    publicKey: Buffer;
    secretKey: Buffer;
  }

  interface HyperswarmSocket extends EventEmitter {
    remotePublicKey: Buffer;
    write(data: Buffer): boolean;
    end(): void;
  }

  interface Discovery {
    flushed(): Promise<void>;
    destroy(): Promise<void>;
  }

  interface JoinOptions {
    client?: boolean;
    server?: boolean;
  }

  class Hyperswarm extends EventEmitter {
    keyPair: KeyPair;
    constructor(options?: Record<string, unknown>);
    join(topic: Buffer, options?: JoinOptions): Discovery;
    leave(topic: Buffer): Promise<void>;
    destroy(): Promise<void>;
    on(event: 'connection', listener: (socket: HyperswarmSocket) => void): this;
  }

  export = Hyperswarm;
}
