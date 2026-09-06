"use client";

import { supabase } from "@/lib/supabase/client";

export type SourceKind = "photo" | "pdf" | "manual";

export type Item = {
  id: string;
  assignment_id: string;
  position: number;
  label: string;
  body: string;
  uncertain: boolean;
  done_at: string | null;
};

export type Assignment = {
  id: string;
  title: string;
  subject_id: string | null;
  source_kind: SourceKind;
  due_on: string | null;
  created_at: string;
  archived_at: string | null;
};

/** An assignment plus the two counts every screen needs. */
export type AssignmentSummary = Assignment & {
  total: number;
  done: number;
  /** The shape lib/pace.mjs reads: a calendar day or nothing. */
  dueOn: string | null;
};

export type Draft = {
  title: string;
  dueOn: string | null;
  sourceKind: SourceKind;
  items: { label: string; text: string; uncertain: boolean }[];
};

function need() {
  const client = supabase();
  if (!client) throw new Error("not_configured");
  return client;
}

/**
 * Everything open, with its counts, in one round trip.
 *
 * The counts are computed here from the returned rows rather than stored on the
 * assignment. A stored count is wrong from the moment an exercise is ticked in
 * another tab, and then every number built on it — the pace, the ring, "three
 * today" — is wrong too, quietly.
 */
export async function listOpenAssignments(): Promise<AssignmentSummary[]> {
  const { data, error } = await need()
    .from("assignment")
    .select("id, title, subject_id, source_kind, due_on, created_at, archived_at, assignment_item(id, done_at)")
    .is("archived_at", null)
    .order("due_on", { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const items = (row.assignment_item ?? []) as { done_at: string | null }[];
    return {
      id: row.id,
      title: row.title,
      subject_id: row.subject_id,
      source_kind: row.source_kind as SourceKind,
      due_on: row.due_on,
      dueOn: row.due_on,
      created_at: row.created_at,
      archived_at: row.archived_at,
      total: items.length,
      done: items.filter((i) => i.done_at).length,
    };
  });
}

export async function getAssignment(
  id: string,
): Promise<{ assignment: Assignment; items: Item[] } | null> {
  const client = need();

  const { data: assignment, error } = await client
    .from("assignment")
    .select("id, title, subject_id, source_kind, due_on, created_at, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!assignment) return null;

  const { data: items, error: itemsErr } = await client
    .from("assignment_item")
    .select("id, assignment_id, position, label, body, uncertain, done_at")
    .eq("assignment_id", id)
    .order("position", { ascending: true });

  if (itemsErr) throw itemsErr;
  return { assignment: assignment as Assignment, items: (items ?? []) as Item[] };
}

/**
 * Save a corrected list.
 *
 * The assignment row goes in first and the exercises second, so a failure
 * halfway leaves an assignment with no exercises rather than orphaned rows —
 * an empty assignment is something the student can see and fix from the app,
 * and rows with no parent are not.
 */
export async function createAssignment(draft: Draft): Promise<string> {
  const client = need();
  const { data: auth } = await client.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("signed_out");

  const { data: assignment, error } = await client
    .from("assignment")
    .insert({
      user_id: userId,
      title: draft.title,
      due_on: draft.dueOn,
      source_kind: draft.sourceKind,
    })
    .select("id")
    .single();

  if (error) throw error;

  if (draft.items.length) {
    const { error: itemsErr } = await client.from("assignment_item").insert(
      draft.items.map((item, i) => ({
        assignment_id: assignment.id,
        // Position comes from the order on screen after the student has
        // corrected it — the one thing the extraction prompt exists to protect.
        position: i + 1,
        label: item.label,
        body: item.text,
        uncertain: item.uncertain,
      })),
    );
    if (itemsErr) throw itemsErr;
  }

  return assignment.id as string;
}

export async function setItemDone(id: string, done: boolean): Promise<void> {
  const { error } = await need()
    .from("assignment_item")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function archiveAssignment(id: string): Promise<void> {
  const { error } = await need()
    .from("assignment")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** How much of this month's scanning budget is gone. Counts only — the limits live in policy.mjs. */
export async function aiUsage(task = "extract"): Promise<{ usedThisMonth: number; usedToday: number }> {
  const { data, error } = await need().rpc("my_ai_usage", { p_task: task });
  if (error) throw error;
  return {
    usedThisMonth: Number(data?.used_this_month ?? 0),
    usedToday: Number(data?.used_today ?? 0),
  };
}
