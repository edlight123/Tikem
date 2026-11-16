import {Config} from '@remotion/cli/config';
import {existsSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);

// Reuse the headless Chrome Playwright already installed instead of downloading another one.
const playwrightShell = join(
	homedir(),
	'Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell',
);
if (existsSync(playwrightShell)) {
	Config.setBrowserExecutable(playwrightShell);
}
