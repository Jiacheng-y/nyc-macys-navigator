import 'dotenv/config';
import { config } from './config';
import { createApp } from './app';

createApp().listen(config.port, () => {
  const mode = config.forceDemo ? 'DEMO (forced)' : 'auto';
  console.log(`ParadePilot API on http://localhost:${config.port}  [mode: ${mode}]`);
  console.log(`  Google routing: ${config.googleServerKey ? 'key set' : 'no key → demo grid router'}`);
  console.log(`  TomTom traffic: ${config.tomtomKey ? 'key set' : 'no key → simulated'}`);
  console.log(`  BestTime venues: ${config.besttimeKey ? 'key set' : 'no key → simulated'}`);
});
