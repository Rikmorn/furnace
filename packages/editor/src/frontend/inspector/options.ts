import { createContext, useContext } from "react";

/** Lookup lists the ref renderers need, supplied by the host panel (InspectPanel). */
export type InspectorOptions = {
  resourceIds: (table: string) => string[];
  entityIds: () => string[];
};

export const InspectorOptionsContext = createContext<InspectorOptions>({
  resourceIds: () => [],
  entityIds: () => [],
});

export const useInspectorOptions = () => useContext(InspectorOptionsContext);
