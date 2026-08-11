export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type PublicProvider = Omit<Provider, 'apiKey'>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  providerId: string;
  model: string;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export type ChatEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: NonNullable<ChatResponse['usage']> }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionTurn {
  round: number;
  providerId: string;
  model: string;
  content: string;
}

export interface DiscussionRequest {
  providerModels: { providerId: string; model: string }[];
  rounds: number;
  initialPrompt: string;
  systemPrompt?: string;
  maxTokensPerTurn?: number;
  temperature?: number;
}

export interface DiscussionResult {
  sessionId: string;
  turns: DiscussionTurn[];
  summary: string;
}
