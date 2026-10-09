export interface GradeResult {
  /** GTO frequency of the user's chosen action (0-1). */
  score: number;
  /** Index of the highest-frequency action. */
  bestIndex: number;
  isBest: boolean;
}

/**
 * Mixed-strategy scoring: the score is simply the GTO frequency of the action
 * the user picked, so genuinely mixed spots award partial credit.
 */
export function gradeAnswer(freqs: number[], chosenIndex: number): GradeResult {
  let bestIndex = 0;
  for (let i = 1; i < freqs.length; i++) {
    if (freqs[i] > freqs[bestIndex]) bestIndex = i;
  }
  const score = freqs[chosenIndex] ?? 0;
  return { score, bestIndex, isBest: chosenIndex === bestIndex };
}
