import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

class SqliteStatement implements D1PreparedStatement {
  constructor(
    readonly db: DatabaseSync,
    readonly query: string,
    readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteStatement(this.db, this.query, values.map((value) => {
      if (typeof value === "string" || typeof value === "number" || value === null) return value;
      throw new Error("Unsupported test binding.");
    }));
  }

  execute<T>(): D1Result<T> {
    const statement = this.db.prepare(this.query);
    const results = statement.columns().length ? statement.all(...this.values) : [];
    if (!statement.columns().length) statement.run(...this.values);
    return {
      success: true,
      results: results as T[],
      meta: {
        duration: 0, size_after: 0, rows_read: results.length, rows_written: 0,
        last_row_id: 0, changed_db: true, changes: 0,
      },
    };
  }

  async all<T>(): Promise<D1Result<T>> { return this.execute<T>(); }
  async run<T>(): Promise<D1Result<T>> { return this.execute<T>(); }
  async first<T>(column?: string): Promise<T | null> {
    const row = this.execute<Record<string, unknown>>().results[0];
    return (column ? row?.[column] ?? null : row ?? null) as T | null;
  }
  raw<T>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T>(options?: { columnNames?: false }): Promise<T[]>;
  async raw(): Promise<never> { throw new Error("raw is not used by chat history."); }
}

export class SqliteD1 implements Pick<D1Database, "prepare" | "batch"> {
  readonly db = new DatabaseSync(":memory:");
  failWrites = false;

  constructor() {
    this.db.exec(readFileSync("migrations/0001_chat_history.sql", "utf8"));
  }

  prepare(query: string): D1PreparedStatement { return new SqliteStatement(this.db, query); }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (this.failWrites) throw new Error("Injected D1 outage");
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteStatement)) throw new Error("Unknown statement.");
        return statement.execute<T>();
      });
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
