import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { App } from './App';

const initialSnapshot = (window as unknown as { __VISUALIZER_SNAPSHOT__: unknown }).__VISUALIZER_SNAPSHOT__;
hydrateRoot(document.getElementById('root')!, <App initialSnapshot={initialSnapshot} />);
