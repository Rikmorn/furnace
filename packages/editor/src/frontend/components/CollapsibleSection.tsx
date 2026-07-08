import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";

/**
 * A titled, collapsible inspector section (the IA unit for a component / resource /
 * settings block). Presentational: the caller owns the open-state default and the
 * onOpenChange side effect (persistence), so this stays a dumb wrapper. The chevron
 * rotates with the trigger's data-state.
 */
export function CollapsibleSection({
  title,
  defaultOpen,
  onOpenChange,
  children,
}: {
  title: ReactNode;
  defaultOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded py-0.5 text-left text-xs font-semibold text-foreground hover:bg-muted/50">
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pl-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}
