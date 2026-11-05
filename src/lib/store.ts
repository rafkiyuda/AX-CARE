"use client";
import { create } from "zustand";
import { createSim, startScenario, tick } from "./sim";
import type { Scenario, Sim } from "./types";

// The simulation is a mutable singleton (50,000 welds, sample buffers); React re-renders on a version bump.
let simRef: Sim | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const useVersion = create<{ v: number; paused: boolean }>(() => ({ v: 0, paused: false }));

export function getSim(): Sim {
  if (!simRef) simRef = createSim();
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // dev-only debug handles for testing scenarios from the console
    const w = window as unknown as { __axcare: Sim; __axcareStart: (id: Scenario["id"]) => void };
    w.__axcare = simRef;
    w.__axcareStart = (id) => act((s) => startScenario(s, id));
  }
  return simRef;
}

export function bump() {
  useVersion.setState((s) => ({ v: s.v + 1 }));
}

/** Subscribe to the sim; the component re-renders every tick and after every action. */
export function useSim(): Sim {
  useVersion((s) => s.v);
  return getSim();
}

export function usePaused() {
  return useVersion((s) => s.paused);
}

export function setPaused(p: boolean) {
  useVersion.setState({ paused: p });
}

export function startTicker() {
  if (timer) return;
  timer = setInterval(() => {
    if (useVersion.getState().paused) return;
    tick(getSim());
    bump();
  }, 1000);
}

/** Full reset (scenario S0) keeping tier, language, role, thresholds and value settings. */
export function resetSim() {
  const old = getSim();
  simRef = createSim({ tier: old.tier, lang: old.lang, role: old.role, thresholds: old.thresholds, value: old.value });
  bump();
}

/** Run a mutation on the sim, then re-render. */
export function act<T>(fn: (sim: Sim) => T): T {
  const r = fn(getSim());
  bump();
  return r;
}
