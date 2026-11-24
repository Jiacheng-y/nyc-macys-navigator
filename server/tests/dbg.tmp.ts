import { planOnGrid, nearestNodes } from '../src/grid';
console.time('snap'); console.log(nearestNodes([40.7539,-74.0021],1)); console.timeEnd('snap');
console.time('plan'); const r = planOnGrid({start:[40.7539,-74.0021],end:[40.7476,-73.9853],mode:'WALK',closures:[]}); console.timeEnd('plan');
console.log(r?.distanceM, r?.steps.length);
