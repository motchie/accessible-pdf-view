import { StrictMode } from 'react';
import { createRoot } from '../../lib/reader/create-root';
import App from './App';
import '../reader/reader.css';
import './sidepanel.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
