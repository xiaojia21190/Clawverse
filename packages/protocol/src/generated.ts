// Auto-generated from clawverse.proto - DO NOT EDIT
import protobuf from 'protobufjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = join(__dirname, 'clawverse.proto');

let root: protobuf.Root | null = null;

export async function getRoot(): Promise<protobuf.Root> {
  if (!root) {
    root = await protobuf.load(protoPath);
  }
  return root;
}

export interface IHeartbeat {
  peerId: string;
  cpuUsage: number;
  ramUsage: number;
  x: number;
  y: number;
  mood: string;
  timestamp: number | Long;
}

export interface IYjsSync {
  update: Uint8Array;
}

export interface IAppearance {
  form: string;
  primaryColor: string;
  secondaryColor: string;
  accessories: string[];
}

export interface IDNA {
  id: string;
  name: string;
  persona: string;
  archetype: string;
  modelTrait: string;
  badges: string[];
  appearance?: IAppearance;
}

export interface IPeerAnnounce {
  peerId: string;
  dna?: IDNA;
}

export interface IPrivateMessage {
  from: string;
  to: string;
  content: string;
}

export interface ITaskRequest {
  taskId: string;
  fromPeerId: string;
  fromName: string;
  context: string;
  question: string;
  ts: number | Long;
}

export interface ITaskResult {
  taskId: string;
  success: boolean;
  result: string;
  ts: number | Long;
}

export interface ITradeRequest {
  tradeId: string;
  fromPeerId: string;
  resource: string;
  amount: number;
  resourceWant: string;
  amountWant: number;
  ts: number | Long;
}

export interface ITradeResult {
  tradeId: string;
  accepted: boolean;
  reason: string;
  ts: number | Long;
}

export interface IClawverseMessage {
  version: number;
  heartbeat?: IHeartbeat;
  yjsSync?: IYjsSync;
  announce?: IPeerAnnounce;
  privateMsg?: IPrivateMessage;
  taskRequest?: ITaskRequest;
  taskResult?: ITaskResult;
  tradeRequest?: ITradeRequest;
  tradeResult?: ITradeResult;
}

export type MessagePayload =
  | { type: 'heartbeat'; data: IHeartbeat }
  | { type: 'yjsSync'; data: IYjsSync }
  | { type: 'announce'; data: IPeerAnnounce }
  | { type: 'privateMsg'; data: IPrivateMessage }
  | { type: 'taskRequest'; data: ITaskRequest }
  | { type: 'taskResult'; data: ITaskResult }
  | { type: 'tradeRequest'; data: ITradeRequest }
  | { type: 'tradeResult'; data: ITradeResult };

type Long = number;
