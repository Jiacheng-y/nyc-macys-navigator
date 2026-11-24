import { useEffect, useId, useRef, useState } from 'react';
import type { Place } from '@shared/types';
import { api } from '../api';

export default function PlaceField({ label, value, onChange }: { label: string; value: Place; onChange: (p: Place) => void }) {
  const id = useId();
  const [text, setText] = useState(value.label);
  const [list, setList] = useState<Place[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<number>();

  useEffect(() => setText(value.label), [value.label]);

  const search = (q: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.places(q);
        setList(r.places.slice(0, 8));
        setNote(r.note);
        setActive(0);
      } catch { setList([]); }
    }, 250);
  };
  const pick = (p: Place) => { onChange(p); setText(p.label); setOpen(false); };

  return (
    <div className="relative">
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id} className="input" value={text} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        onFocus={() => { setOpen(true); search(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); search(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open && list[active]) { e.preventDefault(); pick(list[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-[900] mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gold bg-white shadow-cozy">
          {list.map((p, i) => (
            <li key={p.label + i} role="option" aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-cream font-bold' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              {p.label}
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-bark">No matches. Paste “lat, lng” to use any point.</li>}
          {note && <li className="border-t border-gold/40 px-3 py-2 text-xs text-bark">{note}</li>}
        </ul>
      )}
    </div>
  );
}
