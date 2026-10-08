import type { PluginClientContext, PluginComposerRef } from "@getpaseo/plugin/client";

export interface Snippet {
  id: string;
  title: string;
  text: string;
  placement: "prepend" | "append" | "reference";
  order: number;
}
interface Selection extends Snippet { start: number; end: number; edited: boolean }
interface Composition {
  text: string;
  selected: Selection[];
  submissionRevision: number;
  preservedEdits: boolean;
}
export function compareSnippets(a: Pick<Snippet, "order" | "title" | "id">, b: Pick<Snippet, "order" | "title" | "id">) {
  return a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
export function changeSelection(previous: Composition, text: string, snippet: Snippet): Composition {
  if (snippet.placement === "reference") throw new Error("Reference prompts change Pi's system instructions. They cannot be selected for this conversation draft.");
  let prefix = 0;
  while (prefix < previous.text.length && prefix < text.length && previous.text[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.text.length - prefix && suffix < text.length - prefix && previous.text[previous.text.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
  const oldEnd = previous.text.length - suffix;
  const delta = text.length - previous.text.length;
  const changed = previous.text !== text;
  const selected = previous.selected.map((item) => {
    if (!changed || item.edited) return { ...item };
    if (oldEnd <= item.start && !(prefix === item.start && item.placement === "prepend")) return { ...item, start: item.start + delta, end: item.end + delta };
    if (prefix >= item.end) return { ...item };
    // Text edited inside a prompt becomes user-owned. Never delete or overwrite it on a toggle.
    return { ...item, edited: true };
  });
  let body = text;
  for (const item of [...selected].filter((item) => !item.edited).sort((a, b) => b.start - a.start)) {
    body = body.slice(0, item.start) + body.slice(item.end);
  }
  const exists = selected.some((item) => item.id === snippet.id);
  const next = exists ? selected.filter((item) => item.id !== snippet.id) : [...selected, { ...snippet, start: 0, end: 0, edited: false }];
  const sorted = next.filter((item) => !item.edited).sort(compareSnippets);
  let composed = "";
  const ranges: Selection[] = [];
  for (const item of sorted.filter((item) => item.placement === "prepend")) {
    const start = composed.length;
    composed += item.text + "\n\n";
    ranges.push({ ...item, start, end: composed.length });
  }
  composed += body;
  for (const item of sorted.filter((item) => item.placement === "append")) {
    const start = composed.length;
    composed += "\n\n" + item.text;
    ranges.push({ ...item, start, end: composed.length });
  }
  return { ...previous, preservedEdits: selected.some((item) => item.edited), text: composed, selected: [...ranges, ...next.filter((item) => item.edited)] };
}
export function createPromptComposition(client: Pick<PluginClientContext, "composer">) {
  const states = new Map<string, Composition>();
  const refs = new Map<string, PluginComposerRef>();
  const listeners = new Set<() => void>();
  const removers: Array<() => void> = [];
  function emit() { for (const listener of listeners) listener(); }
  function composer(agentId: string) {
    if (!client.composer) throw new Error("This Paseo client needs the local composer update. Reload the desktop window before selecting prompts.");
    let ref = refs.get(agentId);
    if (!ref) {
      ref = client.composer.ref(agentId);
      refs.set(agentId, ref);
      removers.push(ref.subscribe((draft) => {
        const state = states.get(agentId);
        if (!state) return;
        if (draft.submissionRevision !== state.submissionRevision) {
          states.delete(agentId);
          emit();
        }
      }));
    }
    return ref;
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    selected(agentId: string) { return states.get(agentId)?.selected ?? EMPTY; },
    toggle(agentId: string, snippet: Snippet) {
      const ref = composer(agentId);
      const draft = ref.getDraft();
      const previous = states.get(agentId) ?? { text: draft.text, selected: [], submissionRevision: draft.submissionRevision, preservedEdits: false };
      const next = changeSelection(previous, draft.text, snippet);
      ref.replaceDraft({ text: next.text, revision: draft.revision });
      states.set(agentId, next);
      emit();
      return next.preservedEdits;
    },
    dispose() { for (const remove of removers) remove(); states.clear(); refs.clear(); listeners.clear(); },
  };
}
const EMPTY: Selection[] = [];
export type PromptComposition = ReturnType<typeof createPromptComposition>;
