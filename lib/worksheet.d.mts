export type MaterialStats = {
  chars: number; words: number; realWords: number;
  letterShare: number; digitShare: number; vocabulary: number;
};
export type Unsuitable = {
  code: string; title: string; detail: string; fix: string; stats: MaterialStats;
};
export type NormalisedItem = {
  position: number; label: string; text: string;
  difficulty: number | null; uncertain: boolean;
};

export declare const WORKSHEET_MIN_CHARS: number;
export declare const MAX_LABEL_CHARS: number;
export declare const MAX_TEXT_CHARS: number;
export declare const MAX_ITEMS: number;
export declare function materialStats(text: unknown): MaterialStats;
export declare function assessWorksheetMaterial(text: unknown): Unsuitable | null;
export declare function buildExtractPrompt(text: string): string;
export declare function extractJSON(text: unknown): unknown;
export declare function normaliseItems(reply: unknown): { language: string; items: NormalisedItem[] };
export declare function renumber<T extends { position: number }>(items: T[]): T[];

export declare const DIFFICULTY: Record<number, { label: string; hint: string }>;
export declare const DIFFICULTY_MIN: number;
export declare const DIFFICULTY_MAX: number;
export declare const MAX_RATE_ITEMS: number;
export declare const RATE_TEXT_CHARS: number;
export declare function cleanDifficulty(value: unknown): number | null;
export declare function difficultyCatalogue(): string;
export declare function fitRateItems(
  items: { label?: string; text?: string }[], maxChars: number,
): { items: { label: string; text: string }[]; dropped: number };
export declare function buildRatePrompt(items: { label?: string; text?: string }[]): string;
export declare function normaliseRatings(reply: unknown, count: number): Map<number, number>;
export declare function applyRatings<T extends { difficulty?: number | null }>(
  items: T[], ratings: Map<number, number>,
): T[];
