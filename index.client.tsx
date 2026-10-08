import type { PluginClientContext, PluginSidebarItemProps, PluginScreenProps, PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { createPromptComposition } from "./client/composition";
import { CompositionContext } from "./client/composition-context";
import { contributePromptPills } from "./client/pill";
import { PromptLibrary, PromptPanel } from "./client/prompts";
import { promptAttachment, readPrompt } from "./shared/prompts";

function LibraryItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="NotebookPen" active={currentScreen?.screenId === "library"} onPress={() => openScreen({ screenId: "library" })} />;
}

export default function contribute(client: PluginClientContext) {
  const composition = createPromptComposition(client);
  function Library(props: PluginScreenProps) { return <CompositionContext.Provider value={composition}><PromptLibrary {...props} /></CompositionContext.Provider>; }
  function Panel(props: PluginAgentPanelProps) { return <CompositionContext.Provider value={composition}><PromptPanel {...props} /></CompositionContext.Provider>; }
  client.addScreen({ id: "library", title: "Prompts", Component: Library });
  client.addSidebarHeaderItem({ id: "library", title: "Prompts", Component: LibraryItem });
  client.addWorkspacePanel({ id: "prompts", title: "Prompts", icon: "NotebookPen", context: "agent", Component: Panel });
  client.addCommandCenterItem({ id: "open-library", title: "Open prompt library", icon: "NotebookPen", context: "global", onSelect: ({ openScreen }) => openScreen({ screenId: "library" }) });
  client.addCommandCenterItem({ id: "agent-prompts", title: "Use saved prompts", icon: "NotebookPen", context: "agent", onSelect: ({ openPanel }) => openPanel("prompts") });
  client.addSlashCommand({ name: "prompts", description: "Open your prompt library", argumentHint: "", context: "agent", onSubmit: ({ openPanel }) => openPanel("prompts") });
  client.addSlashCommand({
    name: "prompt", description: "Insert a saved prompt into this conversation draft", argumentHint: "<prompt-id>", context: "agent",
    async onSubmit({ args, agent, rpc }) {
      if (!args) throw new Error("Enter a prompt ID, for example /prompt code-review. Use /prompts to browse.");
      const prompt = await rpc(readPrompt, { id: args.replace(/\.md$/i, "") });
      if (prompt.archived) throw new Error("This prompt is archived. Restore it from the library first.");
      composition.toggle(agent.id, { ...prompt, text: prompt.content });
    },
  });
  client.addAttachmentSource(promptAttachment);
  const removePills = contributePromptPills(client, composition);
  return () => { removePills(); composition.dispose(); };
}
