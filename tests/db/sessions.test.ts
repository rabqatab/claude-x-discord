import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionsDB } from "../../src/db/sessions.js";

describe("SessionsDB", () => {
  let db: SessionsDB;
  beforeEach(() => { db = new SessionsDB(":memory:"); });
  afterEach(() => { db.close(); });

  it("registers and retrieves a project", () => {
    db.registerProject({ forumTopicId: "topic_1", projectName: "myapp", projectPath: "/home/user/myapp" });
    const project = db.getProjectByTopicId("topic_1");
    expect(project).toBeDefined();
    expect(project!.project_name).toBe("myapp");
  });

  it("updates session ID for a project", () => {
    db.registerProject({ forumTopicId: "topic_1", projectName: "myapp", projectPath: "/home/user/myapp" });
    db.updateSession("topic_1", "sess_001", 12345);
    const project = db.getProjectByTopicId("topic_1");
    expect(project!.session_id).toBe("sess_001");
    expect(project!.claude_pid).toBe(12345);
  });

  it("lists all projects", () => {
    db.registerProject({ forumTopicId: "t1", projectName: "a", projectPath: "/a" });
    db.registerProject({ forumTopicId: "t2", projectName: "b", projectPath: "/b" });
    expect(db.listProjects()).toHaveLength(2);
  });

  it("unregisters a project", () => {
    db.registerProject({ forumTopicId: "t1", projectName: "a", projectPath: "/a" });
    db.unregisterProject("a");
    expect(db.getProjectByTopicId("t1")).toBeUndefined();
  });
});
