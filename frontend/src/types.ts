export type Algorithm = "token_bucket" | "sliding_window";

export interface AlgorithmState {
  capacity?: number;
  refill_rate?: number;
  tokens?: number;
  count?: number;
  limit?: number;
}

export interface DemoEvent {
  timestamp: string;
  algorithm: Algorithm;
  key: string;
  request_id?: string;
  latency_ms?: number;
  allowed: boolean;
  remaining: number;
  retry_after: number;
  algorithm_state?: AlgorithmState;
}
