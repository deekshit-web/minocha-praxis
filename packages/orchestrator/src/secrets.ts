const SECRET = /(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+|sk-[a-z0-9]{8,}/gi;

export function findSecrets(text: string): string[] {
  SECRET.lastIndex = 0;
  return [...text.matchAll(SECRET)].map((match) => match[0]);
}
