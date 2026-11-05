"use client";
import { create } from "zustand";

interface UIState {
  copilotOpen: boolean;
  copilotPrompt: string | null;
  toast: string | null;
  openCopilot: (prompt?: string) => void;
  closeCopilot: () => void;
  showToast: (s: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUI = create<UIState>((set) => ({
  copilotOpen: false,
  copilotPrompt: null,
  toast: null,
  openCopilot: (prompt) => set({ copilotOpen: true, copilotPrompt: prompt ?? null }),
  closeCopilot: () => set({ copilotOpen: false, copilotPrompt: null }),
  showToast: (s) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: s });
    toastTimer = setTimeout(() => set({ toast: null }), 3200);
  },
}));

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
