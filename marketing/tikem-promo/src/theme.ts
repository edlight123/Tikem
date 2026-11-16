import {continueRender, delayRender, staticFile} from 'remotion';

export const FPS = 30;
export const BPM = 125;
/** Frame where beat n lands (125 BPM at 30fps = 14.4 frames per beat). */
export const b = (n: number) => Math.round((n * 60 * FPS) / BPM);

export const C = {
	bg: '#050505',
	ink: '#F4F1EA',
	teal: '#14B8A6',
	tealBright: '#2DD4BF',
	muted: 'rgba(244,241,234,0.62)',
};

export const SERIF = 'InstrumentSerif';
export const SERIF_ITALIC = 'InstrumentSerifItalic';
export const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, sans-serif';

const handle = delayRender('Loading fonts');
Promise.all([
	new FontFace(SERIF, `url(${staticFile('fonts/InstrumentSerif.ttf')})`).load(),
	new FontFace(SERIF_ITALIC, `url(${staticFile('fonts/InstrumentSerif-Italic.ttf')})`).load(),
])
	.then((faces) => {
		faces.forEach((f) => document.fonts.add(f));
		continueRender(handle);
	})
	.catch((err) => {
		console.error(err);
		continueRender(handle);
	});
