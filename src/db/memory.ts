import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface Memory {
  id: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  created_at: number;
}

export interface Conversation {
  id: string;
  topic_id: string;
  role: string;
  content: string;
  timestamp: number;
}

export class MemoryDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        value,
        content='memories',
        content_rowid='rowid'
      )
    `);

    // Content sync triggers for FTS5
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, value) VALUES (new.rowid, new.value);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, value) VALUES ('delete', old.rowid, old.value);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, value) VALUES ('delete', old.rowid, old.value);
        INSERT INTO memory_fts(rowid, value) VALUES (new.rowid, new.value);
      END
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER DEFAULT (unixepoch())
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_topic_id
      ON conversations(topic_id)
    `);
  }

  addMemory(opts: {
    key: string;
    value: string;
    source: string;
    confidence?: number;
  }): void {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, key, value, source, confidence)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, opts.key, opts.value, opts.source, opts.confidence ?? 1.0);
  }

  remember(content: string): void {
    this.addMemory({
      key: "explicit",
      value: content,
      source: "explicit",
      confidence: 1.0,
    });
  }

  search(query: string, limit: number = 10): Memory[] {
    // Convert space-separated words into OR-joined prefix tokens
    // so "docker volume data loss" becomes "docker* OR volume* OR data* OR loss*"
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `${w}*`)
      .join(" OR ");

    if (!ftsQuery) return [];

    const stmt = this.db.prepare(`
      SELECT m.*
      FROM memory_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(ftsQuery, limit) as Memory[];
  }

  decayConfidence(factor: number): void {
    const stmt = this.db.prepare(`
      UPDATE memories SET confidence = confidence * ?
    `);
    stmt.run(factor);
  }

  addConversation(opts: {
    topicId: string;
    role: string;
    content: string;
  }): void {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, topic_id, role, content)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, opts.topicId, opts.role, opts.content);
  }

  getConversationHistory(topicId: string, limit: number): Conversation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE topic_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    return stmt.all(topicId, limit) as Conversation[];
  }

  close(): void {
    this.db.close();
  }
}
