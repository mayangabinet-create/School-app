export type Subtask = { id: string; title: string; done: boolean };
export type Task = { id: string; title: string; subject: string; due: string; minutes: number; importance: string; done: string | null; subtasks?: Subtask[] };
export type Slot = { id: string; label: string; start: string; end: string; break: boolean; classes: Record<string, string> };
export type Note = { id: string; title: string; text: string; subject: string; bring: boolean; packed: string | null };
export type Exam = { id: string; title: string; subject: string; date: string; topics: { id: string; title: string; date: string; done: boolean }[] };
export type State = { version: 2; tasks: Task[]; slots: Slot[]; notes: Note[]; exams: Exam[] };
export const blank = (): State => ({ version: 2, tasks: [], slots: [], notes: [], exams: [] });
export const id = () => crypto.randomUUID();
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const tomorrow = () => { const d = new Date(); d.setDate(d.getDate()+1); return d; };
export const localInput = (d = new Date()) => `${dateKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
export const urgency = (t: Task, now = Date.now()) => {
  if (t.done) return { label: 'Completed', level: 0 };
  const hours = (new Date(t.due).getTime()-now)/3600000;
  if (hours < 0) return { label: 'Overdue', level: 4 };
  if (hours <= 24) return { label: 'Due soon', level: 3 };
  if (hours <= 72) return { label: 'Coming up', level: 2 };
  return { label: 'On the horizon', level: 1 };
};
export type TaskGroup = 'Overdue' | 'Today' | 'Tomorrow' | 'This week' | 'Later' | 'Completed';
export const taskGroup = (task: Task, now = new Date()): TaskGroup => {
  if (task.done) return 'Completed';
  const due = task.due.slice(0, 10);
  const today = dateKey(now);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due === dateKey(next)) return 'Tomorrow';
  const week = new Date(now);
  week.setDate(week.getDate() + 7);
  return due <= dateKey(week) ? 'This week' : 'Later';
};
export const deadlineText = (task: Task, now = new Date()) => {
  if (task.done) return 'Completed';
  const due = new Date(task.due);
  const milliseconds = due.getTime() - now.getTime();
  const hours = Math.ceil(Math.abs(milliseconds) / 3_600_000);
  if (milliseconds < 0) return hours < 24 ? `${Math.max(1, hours)}h late` : `${Math.ceil(hours / 24)}d late`;
  if (task.due.slice(0, 10) === dateKey(now)) return `${Math.max(1, Math.ceil(milliseconds / 3_600_000))}h left`;
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  const time = task.due.slice(11, 16);
  if (task.due.slice(0, 10) === dateKey(next)) return `Tomorrow · ${time}`;
  const days = Math.max(1, Math.ceil(milliseconds / 86_400_000));
  return days <= 7 ? `${days}d left` : due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export const rank = (t: Task) => urgency(t).level * 10 + (t.importance === 'High' ? 3 : t.importance === 'Low' ? 1 : 2);
export function validateState(value: unknown): State {
  const s = value as State;
  const text = (v: unknown): v is string => typeof v === 'string';
  const date = (v: unknown) => text(v) && v.length > 0 && Number.isFinite(Date.parse(v));
  const nullableDate = (v: unknown) => v === null || date(v);
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const time = (v: unknown) => text(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const records = (items: unknown, valid: (item: any) => boolean): boolean => {
    if (!Array.isArray(items)) return false;
    const ids = new Set<string>();
    return items.every(item => {
      if (!item || !text(item.id) || !item.id || ids.has(item.id)) return false;
      ids.add(item.id);
      return valid(item);
    });
  };
  const valid = s && s.version === 2
    && records(s.tasks, t => text(t.title) && text(t.subject) && date(t.due) && positive(t.minutes) && ['Low','Normal','High'].includes(t.importance) && nullableDate(t.done)
      && (t.subtasks === undefined || records(t.subtasks, item => text(item.title) && typeof item.done === 'boolean')))
    && records(s.slots, t => text(t.label) && time(t.start) && time(t.end) && t.start < t.end && typeof t.break === 'boolean' && t.classes && typeof t.classes === 'object' && !Array.isArray(t.classes) && Object.entries(t.classes).every(([day, subject]) => /^[0-6]$/.test(day) && text(subject)))
    && records(s.notes, t => text(t.title) && text(t.text) && text(t.subject) && typeof t.bring === 'boolean' && nullableDate(t.packed))
    && records(s.exams, t => text(t.title) && text(t.subject) && date(t.date) && records(t.topics, topic => text(topic.title) && date(topic.date) && typeof topic.done === 'boolean'));
  if (!valid) throw new Error('Saved planner data has an unsupported format. Nothing was overwritten.');
  return {version:2,tasks:s.tasks,slots:s.slots,notes:s.notes,exams:s.exams};
}
