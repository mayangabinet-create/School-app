export type MaterialStats = {
  chars: number; words: number; realWords: number;
  letterShare: number; digitShare: number; vocabulary: number;
};
export type Unsuitable = {
  code: string; title: string; detail: string; fix: string; stats: MaterialStats;
};
export type NormalisedItem = {
  position: number; label: string; text: string; uncertain: boolean;
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
