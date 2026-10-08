import { createContext, useContext } from "react";
import type { PromptComposition } from "./composition";
export const CompositionContext = createContext<PromptComposition | null>(null);
export function usePromptComposition() {
  const composition = useContext(CompositionContext);
  if (!composition) throw new Error("Prompt composition is unavailable.");
  return composition;
}
