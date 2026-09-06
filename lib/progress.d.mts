export type Countable = { done_at?: string | null; doneAt?: string | null; difficulty?: number | null };
export type ProgressSummary = {
  total: number;
  today: number;
  thisWeek: number;
  activeDays: number;
  streak: number;
  byDifficulty: Record<string, number>;
  recent: { day: string; count: number }[];
};
export declare const WEEK_DAYS: number;
export declare function streakDays(days: string[], today: string): number;
export declare function summariseProgress(
  items: Countable[], options: { today: string; timeZone?: string },
): ProgressSummary;
