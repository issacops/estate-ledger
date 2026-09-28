import { useEffect } from "react";
import { create } from "zustand";
import type { Estate, User } from "../domain/types";

interface AppState {
  user: User | null;
  estate: Estate | null;
  estates: Estate[];
  route: string;
  dataVersion: number;
  setUser: (u: User | null) => void;
  setEstate: (e: Estate | null) => void;
  setEstates: (list: Estate[]) => void;
  setRoute: (r: string) => void;
  bump: () => void;
}

export const useApp = create<AppState>((set) => ({
  user: null,
  estate: null,
  estates: [],
  route: readHash(),
  dataVersion: 0,
  setUser: (u) => set({ user: u }),
  setEstate: (e) => set({ estate: e }),
  setEstates: (list) => set({ estates: list }),
  setRoute: (r) => set({ route: r }),
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));

function readHash(): string {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h || "dashboard";
}

export function navigate(route: string): void {
  window.location.hash = `#/${route}`;
  useApp.getState().setRoute(route);
}

export function useHashRoute(): string {
  const route = useApp((s) => s.route);
  useEffect(() => {
    const on = () => useApp.getState().setRoute(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function useDataVersion(): number {
  return useApp((s) => s.dataVersion);
}

export function useIsAdmin(): boolean {
  return useApp((s) => s.user?.role === "Admin");
}
