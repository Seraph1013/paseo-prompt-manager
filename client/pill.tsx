import type { PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { previewLines } from "../shared/markdown";
import { searchPrompts } from "../shared/prompts";
import { usePromptComposition } from "./composition-context";
import { CompositionContext } from "./composition-context";
import { compareSnippets, type PromptComposition } from "./composition";
import { inputStyle, radius, useDebounced } from "./ui";

const RESULT_LIMIT = 20;

type Agent = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>["entries"][number]["agent"];

function PromptPicker({ theme, layout, close, ...target }: PluginButtonContentProps) {
  const colors = theme.colors;
  const composition = usePromptComposition();
  const selected = useSyncExternalStore(composition.subscribe, () => composition.selected(target.context === "agent" ? target.agentId : ""));
  const [error, setError] = useState("");
  const toast = useToast();
  const searchRpc = useRpc(searchPrompts);
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), 200);
  const results = useQuery({ queryKey: ["prompt-pill", search], queryFn: () => searchRpc({ query: search }), placeholderData: keepPreviousData });
  const toggle = (item: (NonNullable<typeof results.data>)["items"][number]) => {
    try {
      if (target.context !== "agent") throw new Error("Open this from an agent composer.");
      const preserved = composition.toggle(target.agentId, item);
      setError("");
      if (preserved) toast.show("已保留你手动修改的提示词文本。", { variant: "success" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const items = results.data?.items.slice(0, RESULT_LIMIT) ?? [];
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  return (
    <View style={{ width: layout.compact ? "100%" : 340, flexShrink: 1, minHeight: 0, gap: 8 }}>
      <TextInput accessibilityLabel="Search saved prompts" value={query} onChangeText={setQuery} autoFocus={!layout.compact} autoCapitalize="none" autoCorrect={false} placeholder="Search prompts" placeholderTextColor={colors.foregroundMuted} style={{ ...inputStyle(colors), paddingVertical: 7, fontSize: 13 }} />
      {results.isLoading && <Text style={muted}>Loading…</Text>}
      {results.error && <Text style={{ ...muted, color: colors.statusDanger }}>{results.error.message}</Text>}
      {error && <Text accessibilityRole="alert" style={{ ...muted, color: colors.statusDanger }}>{error}</Text>}
      <Text style={muted}>前置 → 你的正文 → 后置。选择只插入草稿，编辑后由你发送。</Text>
      {results.data && items.length === 0 && <Text style={muted}>{query.trim() ? "No matching prompts." : "No saved prompts yet."}</Text>}
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, maxHeight: layout.compact ? 320 : 360, minHeight: 0 }} contentContainerStyle={{ gap: 8 }}>
      {(["prepend", "append", "reference"] as const).map((placement) => (
        <View key={placement} style={{ gap: 4 }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{placement === "prepend" ? "前置" : placement === "append" ? "后置" : "Reference · 系统参考"}</Text>
          {placement === "reference" && <Text style={muted}>Pi 系统提示词，不能在 Paseo 中自动注入。</Text>}
          {items.filter((item) => item.placement === placement).sort(compareSnippets).map((item) => {
            const checked = selected.some((value) => value.id === item.id);
            return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={`选择 ${item.title}`} aria-checked={checked} accessibilityState={{ checked, disabled: placement === "reference" }} disabled={placement === "reference"} onPress={() => toggle(item)} style={({ pressed }) => ({ gap: 2, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius - 4, backgroundColor: checked || pressed ? colors.surface2 : "transparent", opacity: placement === "reference" ? 0.6 : 1 })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name={checked ? "SquareCheck" : "Square"} size={14} color={colors.foregroundMuted} />
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1, minWidth: 0 }}>{item.title}</Text>
              </View>
              <Text numberOfLines={2} style={{ ...muted, lineHeight: 16 }}>{previewLines(item.text).join("\n") || item.subtitle}</Text>
            </Pressable>;
          })}
        </View>
      ))}
      </ScrollView>
      {(results.data?.items.length ?? 0) > RESULT_LIMIT && <Text style={muted}>Showing {RESULT_LIMIT} of {results.data!.items.length}. Refine the search.</Text>}
    </View>
  );
}

export function contributePromptPills(client: PluginClientContext, composition: PromptComposition) {
  function Picker(props: PluginButtonContentProps) {
    return <CompositionContext.Provider value={composition}><PromptPicker {...props} /></CompositionContext.Provider>;
  }
  const draftPill = client.addComposerPill({
    id: "prompts", scope: "draft",
    button: { title: "选择前置／后置提示词", icon: "NotebookPen", label: "Prompts", behavior: { kind: "popover", Content: Picker } },
  });
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  const register = (agent: Agent) => {
    if (lifetime.signal.aborted || !agent.workspaceId || pills.has(agent.id)) return;
    pills.set(agent.id, client.addComposerPill({
      id: "prompts",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: { title: "选择前置／后置提示词", icon: "NotebookPen", label: "Prompts", behavior: { kind: "popover", Content: Picker } },
    }));
  };
  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const removeAll = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else register(update.agent);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("Prompt pill agent observation failed", error);
    });
  return () => {
    lifetime.abort();
    draftPill.remove();
    removeAll();
  };
}
