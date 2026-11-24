import viewingJson from './data/viewing-areas.json';
import type { LatLng, ViewingArea } from '../../shared/types';
import { nodeXY, xyToLL } from './grid';


export function loadViewing(): { areas: ViewingArea[]; officialLinks: { label: string; url: string }[] } {
  const j = viewingJson as any;
  const areas: ViewingArea[] = j.areas.map((a: any) => {
    const [x, y] = nodeXY(a.anchor.ave, a.anchor.st);
    const [lat, lng] = xyToLL(x + (a.anchor.offsetX ?? 0), y);
    const location: LatLng = { lat, lng };
    return {
      id: a.id, name: a.name, location, description: a.description, verification: a.verification,
      verificationNote: a.verificationNote, officialGuidanceUrl: a.officialGuidanceUrl, accessNote: a.accessNote,
    };
  });
  return { areas, officialLinks: j.officialLinks };
}
