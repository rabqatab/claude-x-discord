import Database from "better-sqlite3";

export interface Project {
  forum_topic_id: string;
  project_name: string;
  project_path: string;
  session_id: string | null;
  claude_pid: number | null;
  status: string;
  created_at: number;
  last_used_at: number;
}

export class SessionsDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        forum_topic_id TEXT PRIMARY KEY,
        project_name TEXT UNIQUE NOT NULL,
        project_path TEXT NOT NULL,
        session_id TEXT,
        claude_pid INTEGER,
        status TEXT DEFAULT 'idle',
        created_at INTEGER DEFAULT (unixepoch()),
        last_used_at INTEGER DEFAULT (unixepoch())
      )
    `);
  }

  registerProject(opts: {
    forumTopicId: string;
    projectName: string;
    projectPath: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO projects (forum_topic_id, project_name, project_path)
      VALUES (?, ?, ?)
    `);
    stmt.run(opts.forumTopicId, opts.projectName, opts.projectPath);
  }

  getProjectByTopicId(topicId: string): Project | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM projects WHERE forum_topic_id = ?"
    );
    return stmt.get(topicId) as Project | undefined;
  }

  getProjectByName(name: string): Project | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM projects WHERE project_name = ?"
    );
    return stmt.get(name) as Project | undefined;
  }

  updateSession(topicId: string, sessionId: string, pid: number): void {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET session_id = ?, claude_pid = ?, last_used_at = unixepoch()
      WHERE forum_topic_id = ?
    `);
    stmt.run(sessionId, pid, topicId);
  }

  setStatus(topicId: string, status: string): void {
    const stmt = this.db.prepare(`
      UPDATE projects SET status = ?, last_used_at = unixepoch()
      WHERE forum_topic_id = ?
    `);
    stmt.run(status, topicId);
  }

  listProjects(): Project[] {
    const stmt = this.db.prepare("SELECT * FROM projects ORDER BY created_at");
    return stmt.all() as Project[];
  }

  unregisterProject(name: string): void {
    const stmt = this.db.prepare(
      "DELETE FROM projects WHERE project_name = ?"
    );
    stmt.run(name);
  }

  close(): void {
    this.db.close();
  }
}
