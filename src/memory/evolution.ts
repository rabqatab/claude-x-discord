export function shouldAutoLearn(sessionCount: number, interval: number): boolean {
  return sessionCount > 0 && sessionCount % interval === 0;
}

export function extractLessons(sessionSummary: string): string[] {
  return sessionSummary
    .split("\n")
    .filter((l) => l.trim())
    .filter(
      (l) =>
        l.includes("learned") ||
        l.includes("lesson") ||
        l.includes("note") ||
        l.includes("important")
    );
}

export function buildPatternAnalysisPrompt(recentSessions: string[]): string {
  return `Analyze these recent session summaries and extract behavioral patterns:\n\n${recentSessions.join("\n---\n")}\n\nIdentify:\n1. Most used programming languages\n2. Common task types\n3. Preferred tools and commands\n4. Work style patterns\n5. Common errors and resolutions\n\nFormat as bullet points.`;
}

export function buildSessionLearnPrompt(): string {
  return `Summarize what you learned from this session. Focus on:\n1. Project-specific knowledge\n2. User preferences\n3. Errors and solutions\n4. Codebase lessons\n\nBe concise, use bullet points.`;
}
