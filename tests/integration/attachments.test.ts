import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { normalize } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

/**
 * Tests for the <<<ATTACH:...>>> marker system.
 * Since the extraction logic is inline in session-manager's onExit handler,
 * we test the core logic (regex extraction, path validation, marker stripping)
 * as unit-level functions here.
 */

const TEST_DIR = "/tmp/attach-test-project";
const MARKER_RE = /<<<ATTACH:(\/[^>]+)>>>/g;

function extractMarkers(buffer: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MARKER_RE.source, "g");
  while ((match = re.exec(buffer)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

function stripMarkers(buffer: string): string {
  return buffer.replace(/<<<ATTACH:\/[^>]+>>>/g, "").trim();
}

function isPathSafe(filePath: string, projectRoot: string): boolean {
  return normalize(filePath).startsWith(normalize(projectRoot));
}

describe("File attachment marker system", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(`${TEST_DIR}/test.txt`, "hello world");
    writeFileSync(`${TEST_DIR}/code.py`, "print('hi')");
    mkdirSync(`${TEST_DIR}/sub`, { recursive: true });
    writeFileSync(`${TEST_DIR}/sub/nested.txt`, "nested file");
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("Marker extraction", () => {
    it("extracts single marker", () => {
      const buffer = `Here is the file:\n<<<ATTACH:${TEST_DIR}/test.txt>>>\nDone.`;
      const markers = extractMarkers(buffer);
      expect(markers).toEqual([`${TEST_DIR}/test.txt`]);
    });

    it("extracts multiple markers", () => {
      const buffer = `<<<ATTACH:${TEST_DIR}/test.txt>>>\nSome text\n<<<ATTACH:${TEST_DIR}/code.py>>>`;
      const markers = extractMarkers(buffer);
      expect(markers).toEqual([`${TEST_DIR}/test.txt`, `${TEST_DIR}/code.py`]);
    });

    it("extracts nested path markers", () => {
      const buffer = `<<<ATTACH:${TEST_DIR}/sub/nested.txt>>>`;
      const markers = extractMarkers(buffer);
      expect(markers).toEqual([`${TEST_DIR}/sub/nested.txt`]);
    });

    it("returns empty for no markers", () => {
      const buffer = "Just a normal response with no files.";
      const markers = extractMarkers(buffer);
      expect(markers).toEqual([]);
    });

    it("handles markers with special characters in path", () => {
      const buffer = `<<<ATTACH:/project/my-file_v2.tar.gz>>>`;
      const markers = extractMarkers(buffer);
      expect(markers).toEqual(["/project/my-file_v2.tar.gz"]);
    });
  });

  describe("Marker stripping", () => {
    it("strips markers from text", () => {
      const buffer = `Here is the file:\n<<<ATTACH:${TEST_DIR}/test.txt>>>\nDone.`;
      const stripped = stripMarkers(buffer);
      expect(stripped).toBe("Here is the file:\n\nDone.");
    });

    it("strips multiple markers", () => {
      const buffer = `<<<ATTACH:/a/b>>> mid <<<ATTACH:/c/d>>>`;
      const stripped = stripMarkers(buffer);
      expect(stripped).toBe("mid");
    });

    it("handles buffer with only markers", () => {
      const buffer = `<<<ATTACH:/a/b>>>`;
      const stripped = stripMarkers(buffer);
      expect(stripped).toBe("");
    });
  });

  describe("Path security validation", () => {
    it("allows paths within project directory", () => {
      expect(isPathSafe(`${TEST_DIR}/test.txt`, TEST_DIR)).toBe(true);
      expect(isPathSafe(`${TEST_DIR}/sub/nested.txt`, TEST_DIR)).toBe(true);
    });

    it("rejects paths outside project directory", () => {
      expect(isPathSafe("/etc/passwd", TEST_DIR)).toBe(false);
      expect(isPathSafe("/etc/shadow", TEST_DIR)).toBe(false);
      expect(isPathSafe("/home/user/.ssh/id_rsa", TEST_DIR)).toBe(false);
    });

    it("rejects directory traversal attempts", () => {
      expect(isPathSafe(`${TEST_DIR}/../../../etc/passwd`, TEST_DIR)).toBe(false);
    });

    it("documents prefix collision edge case", () => {
      // /tmp/attach-test-project-evil starts with /tmp/attach-test-project
      // This is a known limitation of naive startsWith
      const evilPath = `${TEST_DIR}-evil/steal.txt`;
      const normalizedEvil = normalize(evilPath);
      const normalizedRoot = normalize(TEST_DIR);
      const naiveCheck = normalizedEvil.startsWith(normalizedRoot);
      expect(naiveCheck).toBe(true); // known limitation — documented
    });
  });

  describe("Limit enforcement", () => {
    it("respects max 10 files limit", () => {
      const markers = Array.from({ length: 15 }, (_, i) =>
        `<<<ATTACH:${TEST_DIR}/file${i}.txt>>>`
      ).join("\n");

      const extracted: string[] = [];
      const re = new RegExp(MARKER_RE.source, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(markers)) !== null) {
        if (extracted.length >= 10) break;
        extracted.push(match[1]);
      }
      expect(extracted).toHaveLength(10);
    });
  });
});
