import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { DEFAULT_JOURNAL_APPEARANCE, JOURNAL_APPEARANCE_CHANNEL, type JournalAppearance } from "./journal-appearance";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";

const OPEN_EVENT = "threadflow:adjust-journal-ui";
export function openJournalAppearance() { window.dispatchEvent(new Event(OPEN_EVENT)); }
const controls: { key: keyof JournalAppearance; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: "letterSpacing", label: "Letter spacing", min: -1, max: 3, step: 0.05, unit: "px" },
  { key: "lineHeight", label: "Line height", min: 1.2, max: 2.5, step: 0.05, unit: "×" },
  { key: "topPadding", label: "Top padding", min: 0, max: 200, step: 1, unit: "px" },
  { key: "fontSize", label: "Font size", min: 12, max: 24, step: 0.5, unit: "px" },
  { key: "documentWidth", label: "Document width", min: 480, max: 1200, step: 8, unit: "px" },
  { key: "paragraphSpacing", label: "Paragraph spacing", min: 0, max: 2, step: 0.05, unit: "em" },
];

export function JournalAppearanceOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [saved, setSaved] = useState(DEFAULT_JOURNAL_APPEARANCE);
  const [draft, setDraft] = useState<JournalAppearance | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const value = await rpc.call("journal_appearance", {});
      if (request.current !== id) return;
      setSaved(value);
      setReady(true);
      setError(null);
    } catch {
      if (request.current === id) setError("Couldn’t load journal appearance. Try again.");
    }
  }, [rpc]);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh, connection]);
  useRealtime(JOURNAL_APPEARANCE_CHANNEL, () => { void refresh(); });
  useEffect(() => {
    const show = () => { setDraft(null); setOpen(true); void refresh(); };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, [refresh]);
  const appearance = draft ?? saved;
  const close = () => { if (!saving) { setOpen(false); setDraft(null); setError(null); } };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const value = await rpc.call("save_journal_appearance", appearance);
      request.current++;
      setSaved(value);
      setDraft(null);
      setOpen(false);
    } catch { setError("Couldn’t save journal appearance. Your preview is still here; try again."); }
    finally { setSaving(false); }
  };
  return <>
    <style>{`.threadflow-journal-document {
      --journal-letter-spacing: ${appearance.letterSpacing}px;
      --journal-line-height: ${appearance.lineHeight};
      --journal-top-padding: ${appearance.topPadding}px;
      --journal-font-size: ${appearance.fontSize}px;
      --journal-document-width: ${appearance.documentWidth}px;
      --journal-paragraph-spacing: ${appearance.paragraphSpacing}em;
    }`}</style>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-sm sm:left-auto sm:right-6 sm:translate-x-0" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Adjust journal UI</DialogTitle>
          <DialogDescription>Preview changes in your journal. Save to apply them to every day and device.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!ready || saving} className="space-y-4">
          {controls.map(({ key, label, min, max, step, unit }) => <label key={key} className="block text-sm">
            <span className="mb-2 flex justify-between"><span>{label}</span><output>{appearance[key]} {unit}</output></span>
            <input type="range" aria-label={label} min={min} max={max} step={step} value={appearance[key]} className="w-full accent-primary" onChange={(event) => setDraft({ ...appearance, [key]: Number(event.target.value) })} />
          </label>)}
        </fieldset>
        {!ready && !error ? <p role="status" className="text-sm text-muted-foreground">Loading appearance…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error} {!ready ? <button onClick={() => void refresh()}>Retry</button> : null}</p> : null}
        <DialogFooter>
          <Button variant="ghost" disabled={!ready || saving} onClick={() => setDraft(DEFAULT_JOURNAL_APPEARANCE)}>Reset</Button>
          <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
          <Button disabled={!ready || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
