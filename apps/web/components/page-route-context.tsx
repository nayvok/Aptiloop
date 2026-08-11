"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import type { RouteContext } from "@/lib/route-context";

export type PageRouteContextRegistration = (
  routeKey: string,
  context: RouteContext,
) => () => void;

const PageRouteContextRegistry = createContext<{
  register: PageRouteContextRegistration;
  routeKey: string;
} | null>(null);

export function PageRouteContextProvider({
  register,
  routeKey,
  children,
}: {
  register: PageRouteContextRegistration;
  routeKey: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ register, routeKey }), [register, routeKey]);
  return (
    <PageRouteContextRegistry.Provider value={value}>
      {children}
    </PageRouteContextRegistry.Provider>
  );
}

/**
 * Lets a page replace generic pathname labels with validated entity context.
 * Registration is scoped to the exact pathname and query so Back/Forward
 * cannot retain a Course or Lesson label from another route identity.
 */
export function usePageRouteContext(context: RouteContext | null): void {
  const registry = useContext(PageRouteContextRegistry);

  useEffect(() => {
    if (!registry || !context) return;
    return registry.register(registry.routeKey, context);
  }, [context, registry]);
}
