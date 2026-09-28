import { rows, run } from "./db";

class Database {
  static async load(_conn: string): Promise<Database> {
    return new Database();
  }

  async select<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    return rows<T>(sql, params);
  }

  async execute(
    sql: string,
    params: unknown[] = []
  ): Promise<{ lastInsertId: number; rowsAffected: number }> {
    return run(sql, params);
  }

  async close(): Promise<void> {}
}

export default Database;
