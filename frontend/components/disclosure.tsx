"use client";
import {useEffect, useId, useRef, useState, type ReactNode} from "react";
import {SECTION_NAVIGATION_EVENT, scrollToSection} from "@/lib/section-navigation";

/** Mount dense or remotely loaded details only when someone requests them. */
export function Disclosure({title, children, initiallyOpen = false, id: sectionId, revealFor = []}: {title: string; description?: string; children: ReactNode; initiallyOpen?: boolean; id?: string; revealFor?: readonly string[]}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [revealRevision, setRevealRevision] = useState(0);
  const pendingAnchor = useRef<string | null>(null);
  const relatedTargets = revealFor.join("\0");
  const id = useId();
  useEffect(() => {
    if (!sectionId) return;
    const request = (anchor: unknown) => {
      if (typeof anchor !== "string" || !anchor || (anchor !== sectionId && !relatedTargets.split("\0").includes(anchor))) return;
      pendingAnchor.current = anchor;
      setOpen(true);
      setRevealRevision(value => value + 1);
    };
    const fromHash = () => request(window.location.hash.slice(1));
    const fromSearch = (event: Event) => request((event as CustomEvent<unknown>).detail);
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(SECTION_NAVIGATION_EVENT, fromSearch);
    return () => {window.removeEventListener("hashchange", fromHash); window.removeEventListener(SECTION_NAVIGATION_EVENT, fromSearch);};
  }, [sectionId, relatedTargets]);
  useEffect(() => {
    if (!open || !pendingAnchor.current) return;
    const frame = requestAnimationFrame(() => {
      if (pendingAnchor.current) scrollToSection(pendingAnchor.current);
      pendingAnchor.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, revealRevision]);
  return <section id={sectionId} tabIndex={sectionId ? -1 : undefined} className="panel disclosure-panel"><div className="panel-header"><div><h2>{title}</h2></div><button type="button" className="button secondary small-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? "Mostrar menos" : "Mostrar más"}<span aria-hidden="true">{open ? "−" : "+"}</span></button></div>{open && <div id={id} className="disclosure-content">{children}</div>}</section>;
}

export function ProgressiveList<T>({items, render, initialCount = 6, label = "registros", className}: {items: T[]; render: (item: T, index: number) => ReactNode; initialCount?: number; label?: string; className?: string}) {
  const [all, setAll] = useState(false);
  const id = useId();
  return <><div id={id} className={className}>{(all ? items : items.slice(0, initialCount)).map(render)}</div>{items.length > initialCount && <button type="button" className="show-more-button" aria-expanded={all} aria-controls={id} onClick={() => setAll(value => !value)}>{all ? "Mostrar menos" : `Mostrar más ${label} (${items.length - initialCount})`}</button>}</>;
}
