export type PaceStatus = "done" | "overdue" | "due-today" | "scheduled" | "undated";
export type Pace = {
  total: number; done: number; remaining: number; percent: number;
  status: PaceStatus; daysLeft: number | null; perDay: number;
};
export type PaceInput = { total?: number; done?: number; dueOn?: string | null; today: string };

export declare const STATUS: Record<string, PaceStatus>;
export declare function dayNumber(iso: unknown): number | null;
export declare function daysBetween(from: unknown, to: unknown): number | null;
export declare function calendarDay(date: Date, timeZone?: string): string;
export declare function paceFor(input: PaceInput): Pace;
export declare function todayPlan<T extends { dueOn?: string | null; total?: number; done?: number }>(
  assignments: T[], today: string,
): {
  dueToday: number; overdue: number; remaining: number;
  buckets: { overdue: (T & { pace: Pace })[]; dueToday: (T & { pace: Pace })[];
             scheduled: (T & { pace: Pace })[]; undated: (T & { pace: Pace })[] };
};
