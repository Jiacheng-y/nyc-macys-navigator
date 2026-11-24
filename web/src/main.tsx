import React from 'react';
import { createRoot } from 'react-dom/client';
import { configure } from '@engine/config';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App';

// Static (GitHub Pages) build: there is no server, so keys come from build-time VITE_* variables and are PUBLIC.
// Use referrer-restricted, quota-capped keys. See README "Hosting on GitHub Pages".
const env = import.meta.env;
const gKey: string = env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? '';
configure({
  googleBrowserKey: gKey,
  googleServerKey: gKey, // Routes/Geocoding web-service calls are made directly from the browser
  tomtomKey: env.VITE_TOMTOM_API_KEY ?? '',
  besttimeKey: '', // BestTime uses a PRIVATE key: never ship it to a browser. Use VITE_API_BASE with a server instead.
  forceDemo: env.VITE_DEMO_MODE === 'true',
  pollIntervalMs: Number(env.VITE_POLL_INTERVAL_MS) || 30_000,
});

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
