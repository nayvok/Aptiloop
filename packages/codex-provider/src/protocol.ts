export interface CodexAccountResponse {
  account: unknown | null;
  requiresOpenaiAuth: boolean;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description: string;
  }>;
}

export interface CodexModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}

export interface CodexThread {
  id: string;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  status?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface CodexThreadResponse {
  thread: CodexThread;
}

export interface CodexTurnResponse {
  turn: CodexTurn;
}

export interface CodexNotification {
  method: string;
  params: Record<string, unknown>;
}

export type CodexSandbox = "read-only" | "workspace-write";

export interface StartThreadParams {
  model?: string;
  cwd?: string;
  baseInstructions?: string;
  developerInstructions?: string;
  sandbox: CodexSandbox;
  approvalPolicy: "never";
}

export interface ResumeThreadParams extends StartThreadParams {
  threadId: string;
}

export interface StartTurnParams {
  threadId: string;
  input: Array<{ type: "text"; text: string }>;
  model?: string;
  effort?: string;
  approvalPolicy?: "never";
  sandboxPolicy?:
    | { type: "readOnly"; networkAccess: false }
    | { type: "workspaceWrite"; networkAccess: false; writableRoots: string[] };
}

export interface InterruptTurnParams {
  threadId: string;
  turnId: string;
}

export type NotificationListener = (notification: CodexNotification) => void;

export interface CodexTransport {
  connect(): Promise<void>;
  readAccount(): Promise<CodexAccountResponse>;
  listModels(): Promise<CodexModel[]>;
  startThread(params: StartThreadParams): Promise<CodexThreadResponse>;
  resumeThread(params: ResumeThreadParams): Promise<CodexThreadResponse>;
  startTurn(params: StartTurnParams): Promise<CodexTurnResponse>;
  interruptTurn(params: InterruptTurnParams): Promise<void>;
  subscribe(listener: NotificationListener): () => void;
  shutdown(): Promise<void>;
}

export class CodexTransportError extends Error {
  readonly code: "unavailable" | "misconfigured" | "protocol" | "closed";

  constructor(
    code: CodexTransportError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CodexTransportError";
    this.code = code;
  }
}
