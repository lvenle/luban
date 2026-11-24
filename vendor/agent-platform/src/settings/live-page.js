import {withModernDialogs} from './modern-dialogs.js';
import { readFileSync } from 'node:fs';
export function renderLiveSettingsPage() { return withModernDialogs(readFileSync(new URL('./settings.html', import.meta.url), 'utf8')); }
