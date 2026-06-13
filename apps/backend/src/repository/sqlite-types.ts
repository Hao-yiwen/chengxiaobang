export type Row = Record<string, unknown>;
export type SqlParam = string | number | null | Uint8Array;

export interface SqliteConnection {
  exec(sql: string): void;
  run(sql: string, params?: SqlParam[]): void;
  query(sql: string, params?: SqlParam[]): Row[];
}
