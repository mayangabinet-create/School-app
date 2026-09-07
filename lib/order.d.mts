export type Order = "easiest" | "page" | "hardest";

export type Orderable = {
  position?: number;
  difficulty?: number | null;
  done_at?: string | null;
  doneAt?: string | null;
};

export declare const ORDERS: { EASIEST: "easiest"; PAGE: "page"; HARDEST: "hardest" };
export declare const ORDER_VALUES: Order[];
export declare const DEFAULT_ORDER: Order;
export declare const ORDER_LABELS: Record<Order, { label: string; hint: string }>;
export declare function cleanOrder(value: unknown): Order;
export declare function nextUp<T extends Orderable>(items: T[], order?: string): T[];
export declare function startWith<T extends Orderable>(
  items: T[], order?: string,
): { item: T | null; reason: string | null; remaining: number };
