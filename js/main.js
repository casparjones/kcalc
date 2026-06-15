// Entry point: bootstrap Alpine via ESM (avoids init-race with a separate CDN <script>)
import Alpine from 'https://esm.sh/alpinejs@3';
import { createApp } from './app.js';

window.Alpine = Alpine;
Alpine.data('app', createApp);
Alpine.start();

// Hide the loading screen once Alpine is initialized + first paint settled.
// The PRIMARY hide happens in app.js init() after data has loaded; this is a
// safety fallback in case init() never reaches its data-load chain.
setTimeout(function () { document.documentElement.classList.add('app-ready'); }, 8000);
