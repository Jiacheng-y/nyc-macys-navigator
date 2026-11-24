// ILLUSTRATIVE map geometry for official closure rows.
// The official notice lists street names + boundaries only (no coordinates). The lines below are
// approximations placed on a simplified Manhattan grid (see grid.ts). They are used for map drawing and
// route-overlap checks, and every event that uses them is tagged geometryBasis: "illustrative".
// Do not treat them as surveyed centre-lines.
import type { LL } from '../../shared/types';
import { nodeLL, xyToLL } from './grid';

const n = (ave: string, st: number) => nodeLL(ave, st);
const line = (...pts: LL[]) => pts;

export const CLOSURE_GEOMETRY: Record<string, LL[]> = {
  'closure-cpw-72-88': line(n('cpw', 72), n('cpw', 88)),
  'closure-cpw-59-72': line(n('cpw', 72), n('cpw', 60), n('eighth', 59)),
  'closure-st-34-5th-9th': line(n('fifth', 34), n('ninth', 34)),
  'closure-st-65-transverse': line(n('cpw', 65), n('fifth', 65)),
  'closure-st-66-transverse': line(n('cpw', 66), n('fifth', 66)),
  'closure-st-79-transverse': line(n('cpw', 79), n('fifth', 79)),
  'closure-st-59-cps': line(n('fifth', 59), n('eighth', 59)),
  'closure-6th-23-42': line(n('sixth', 23), n('sixth', 42)),
  'closure-6th-42-58': line(n('sixth', 42), n('sixth', 58)),
  'closure-7th-32-42': line(n('seventh', 32), n('seventh', 42)),
  'closure-8th-33-35': line(n('eighth', 33), n('eighth', 35)),
  'closure-st-42': line(n('fifth', 42), n('eighth', 42)),
  'closure-st-57': line(n('fifth', 57), n('eighth', 57)),
  // Broadway runs diagonally: ~6th Ave side at 32nd, crossing 6th at Herald Sq (34th), reaching 7th Ave at 42nd.
  'closure-broadway-32-42': line(xyToLL(70, (32 - 42) * 80.5), xyToLL(0, (34 - 42) * 80.5), xyToLL(-280, 0)),
};
for (const st of [72, 73, 74, 75, 76, 77, 81, 82, 83, 84, 85, 87]) {
  CLOSURE_GEOMETRY[`closure-st-${st}`] = line(n('cpw', st), n('col', st));
}

/** Scheduled parade corridor as described in the notice: CPW → Columbus Circle → CPS → 6th Ave down to 34th St. */
export const PARADE_CORRIDOR: LL[] = [
  n('cpw', 77), n('cpw', 60), n('eighth', 59), n('sixth', 59), n('sixth', 34),
];
