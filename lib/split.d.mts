export type SplitItem = {
  position: number; label: string; text: string;
  difficulty: number | null; uncertain: boolean;
};
export declare const MIN_EXERCISES: number;
export declare const LABEL_CHARS: number;
export declare function splitExercises(text: unknown): {
  items: SplitItem[];
  confidence: "none" | "low" | "medium" | "high";
  method: string;
  markerKind: string | null;
};
