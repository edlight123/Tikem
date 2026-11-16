import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Easing,
	interpolate,
	OffthreadVideo,
	Sequence,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {Backdrop, MUSIC_START, Word} from './Film';
import {Phone} from './Phone';
import {C, FPS, SANS, SERIF_ITALIC} from './theme';

// "Kijan pou w achte biyè": a how-to cut from one real screen recording
// (public/tut/src.mp4, 30fps; iOS AssistiveTouch painted out of it: a mirrored
// patch from the left edge where the layout is symmetric, ffmpeg delogo elsewhere). Each step plays a few ranges of it at their own
// speed: slow where there is something to read or tap, fast through loading.

type Range = [from: number, to: number, rate: number]; // seconds in the recording
type Tap = [at: number, x: number, y: number]; // recording second, screen fraction
type Zoom = [at: number, z: number, x: number, y: number]; // recording second, scale, focus

interface Step {
	title: string;
	ranges: Range[];
	taps?: Tap[];
	zooms?: Zoom[];
}

const STEPS: Step[] = [
	{
		title: 'jwenn yon fèt',
		ranges: [
			[6.0, 7.6, 1],
			[7.6, 11.0, 1.35],
			[12.5, 14.0, 1.15],
		],
		zooms: [
			[6.0, 1.0, 0.5, 0.4],
			[14.0, 1.08, 0.5, 0.4],
		],
	},
	{
		title: 'gade detay yo',
		ranges: [
			[24.0, 25.5, 0.9],
			[36.0, 37.5, 1],
		],
		zooms: [
			[24.0, 1.0, 0.5, 0.25],
			[24.6, 1.3, 0.5, 0.2],
			[25.5, 1.3, 0.5, 0.2],
			[36.0, 1.0, 0.5, 0.4],
			[37.5, 1.08, 0.5, 0.4],
		],
	},
	{
		title: 'mete kòd la',
		ranges: [
			[42.4, 43.1, 1],
			[43.1, 44.3, 2.5],
			[44.3, 46.9, 1.1],
			[46.9, 48.3, 2],
		],
		taps: [
			[42.8, 0.5, 0.92],
			[44.4, 0.5, 0.49],
			[46.7, 0.5, 0.567],
		],
		zooms: [
			[42.4, 1.0, 0.5, 0.5],
			[43.4, 1.0, 0.5, 0.5],
			[44.2, 1.5, 0.5, 0.5],
			[46.9, 1.5, 0.5, 0.5],
			[47.6, 1.0, 0.5, 0.5],
		],
	},
	{
		title: 'chwazi biyè w',
		ranges: [
			[48.1, 48.6, 1],
			[48.6, 51.9, 0.9],
		],
		taps: [
			[48.2, 0.5, 0.92],
			[49.3, 0.92, 0.215],
			[50.3, 0.92, 0.27],
			[50.8, 0.92, 0.27],
			[51.5, 0.5, 0.945],
		],
		zooms: [
			[48.6, 1.0, 0.62, 0.24],
			[49.0, 1.45, 0.62, 0.24],
			[51.0, 1.45, 0.62, 0.24],
			[51.5, 1.0, 0.5, 0.9],
		],
	},
	{
		title: 'peye ak MonCash',
		ranges: [
			[51.9, 52.6, 1.5],
			[52.6, 54.4, 0.8],
			[54.4, 55.4, 2],
		],
		taps: [[53.85, 0.64, 0.945]],
		zooms: [
			[52.6, 1.0, 0.7, 0.4],
			[52.9, 1.5, 0.75, 0.4],
			[53.5, 1.5, 0.75, 0.4],
			[53.75, 1.0, 0.5, 0.6],
		],
	},
	{
		title: 'chèche, filtre',
		ranges: [
			[83.3, 84.0, 1],
			[84.0, 85.8, 2.5],
			[85.8, 89.0, 1.1],
			[92.0, 95.2, 1],
		],
		taps: [
			[83.8, 0.76, 0.107],
			[92.3, 0.9, 0.107],
		],
		zooms: [
			[85.8, 1.0, 0.5, 0.25],
			[86.6, 1.4, 0.5, 0.25],
			[89.0, 1.4, 0.5, 0.25],
			[92.0, 1.0, 0.5, 0.4],
		],
	},
	{
		title: 'biyè w la pare',
		ranges: [
			[98.0, 99.5, 1],
			[106.8, 110.6, 1.1],
			[115.0, 116.2, 1],
			[123.0, 125.9, 1],
		],
		taps: [[107.2, 0.25, 0.374]],
		zooms: [
			[106.8, 1.0, 0.5, 0.3],
			[108.2, 1.45, 0.5, 0.3],
			[110.6, 1.45, 0.5, 0.3],
			[115.0, 1.0, 0.5, 0.45],
			[123.0, 1.0, 0.5, 0.6],
			[125.9, 1.15, 0.5, 0.65],
		],
	},
];

// ---------- timing ----------

const rangeFrames = (r: Range) => Math.round(((r[1] - r[0]) * FPS) / r[2]);
const stepFrames = (s: Step) => s.ranges.reduce((n, r) => n + rangeFrames(r), 0);

/** Local frame (from the start of the step) at which recording second `t` plays. */
const frameOf = (s: Step, t: number): number => {
	let acc = 0;
	for (const r of s.ranges) {
		const len = rangeFrames(r);
		if (t <= r[1]) return acc + Math.max(0, ((t - r[0]) * FPS) / r[2]);
		acc += len;
	}
	return acc;
};

export const INTRO = 75;
export const OUTRO = 105;
const starts: number[] = [];
{
	let at = INTRO;
	for (const s of STEPS) {
		starts.push(at);
		at += stepFrames(s);
	}
}
export const TUTORIAL_DURATION = starts[starts.length - 1] + stepFrames(STEPS[STEPS.length - 1]) + OUTRO;

// ---------- pieces ----------

const PHONE_W = 640;
const BEZEL = PHONE_W * 0.035;
const PHONE_TOP = 400;
// Where a zoomed-in focus point is brought to (frame centre, a bit low).
const TARGET = {x: 540, y: 1060};
const SCREEN_H = (PHONE_W * 2622) / 1206;

const TapRing: React.FC<{at: number; x: number; y: number}> = ({at, x, y}) => {
	const f = useCurrentFrame();
	const t = f - at;
	if (t < -4 || t > 22) return null;
	const press = interpolate(t, [-4, 0, 6], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const ring = interpolate(t, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
	const cx = x * PHONE_W;
	const cy = y * SCREEN_H;
	return (
		<>
			<div
				style={{
					position: 'absolute',
					left: cx - 34,
					top: cy - 34,
					width: 68,
					height: 68,
					borderRadius: 999,
					background: 'rgba(255,255,255,0.9)',
					opacity: press * 0.55,
					transform: `scale(${0.6 + press * 0.4})`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: cx - 34,
					top: cy - 34,
					width: 68,
					height: 68,
					borderRadius: 999,
					border: `4px solid ${C.tealBright}`,
					opacity: t < 0 ? 0 : 1 - ring,
					transform: `scale(${1 + ring * 1.6})`,
				}}
			/>
		</>
	);
};

// One phone for the whole film: the camera glides between push-ins and only
// the screen dissolves from step to step, so nothing jumps.
const zoomKeys = (() => {
	const keys: {f: number; z: number; x: number; y: number}[] = [];
	STEPS.forEach((step, i) => {
		const zs = step.zooms ?? [[step.ranges[0][0], 1, 0.5, 0.5] as Zoom];
		zs.forEach((z) => keys.push({f: starts[i] + frameOf(step, z[0]), z: z[1], x: z[2], y: z[3]}));
	});
	keys.sort((p, q) => p.f - q.f);
	keys.forEach((k, i) => {
		if (i && k.f <= keys[i - 1].f) k.f = keys[i - 1].f + 0.01;
	});
	return keys;
})();

const useCamera = () => {
	const f = useCurrentFrame();
	const opts = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: Easing.inOut(Easing.cubic)};
	const at = (sel: (k: (typeof zoomKeys)[number]) => number) =>
		interpolate(f, zoomKeys.map((k) => k.f), zoomKeys.map(sel), opts);
	return {zoom: at((k) => k.z), fx: at((k) => k.x), fy: at((k) => k.y)};
};


const DISSOLVE = 7;

const Screen: React.FC = () => (
	<>
		{STEPS.map((step, i) => {
			const len = stepFrames(step);
			// The last step also plays under the phone's exit into the outro.
			const tail = i === STEPS.length - 1 ? 24 : DISSOLVE;
			let at = 0;
			return (
				<Sequence key={i} from={starts[i]} durationInFrames={len + tail} layout="none">
					<StepLayer>
						{step.ranges.map((r, j) => {
							// The last range runs DISSOLVE frames longer, under the next step's fade-in.
							const rl = rangeFrames(r) + (j === step.ranges.length - 1 ? tail : 0);
							const el = (
								<Sequence key={j} from={at} durationInFrames={rl} layout="none">
									<OffthreadVideo
										src={staticFile('tut/src.mp4')}
										startFrom={Math.round(r[0] * FPS)}
										playbackRate={r[2]}
										muted
										style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}}
									/>
								</Sequence>
							);
							at += rangeFrames(r);
							return el;
						})}
					</StepLayer>
				</Sequence>
			);
		})}
		{STEPS.map((step, i) =>
			(step.taps ?? []).map((t, j) => <TapRing key={`${i}-${j}`} at={starts[i] + frameOf(step, t[0])} x={t[1]} y={t[2]} />),
		)}
	</>
);

const StepLayer: React.FC<{children: React.ReactNode}> = ({children}) => {
	const f = useCurrentFrame();
	const o = interpolate(f, [0, DISSOLVE], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

const PhoneStage: React.FC = () => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const {zoom, fx, fy} = useCamera();
	const enter = spring({frame: f - (INTRO - 3), fps, config: {damping: 22, stiffness: 110}});
	const outAt = TUTORIAL_DURATION - OUTRO;
	const exit = interpolate(f, [outAt - 4, outAt + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
	const pull = interpolate(zoom, [1, 1.4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const camX = (TARGET.x - (540 - PHONE_W / 2 + fx * PHONE_W)) * pull;
	const camY = (TARGET.y - (PHONE_TOP + BEZEL + fy * SCREEN_H)) * pull;
	// A slow drift keeps the still moments alive.
	const drift = Math.sin(f / 55) * 1.2;
	return (
		<AbsoluteFill style={{perspective: 2200}}>
			<div
				style={{
					position: 'absolute',
					left: 540 - PHONE_W / 2 - BEZEL,
					top: PHONE_TOP,
					opacity: enter * (1 - exit),
					transform: `translate(${camX}px, ${camY + (1 - enter) * 220 + exit * 80}px) scale(${interpolate(enter, [0, 1], [0.94, 1]) * (1 - exit * 0.08) * zoom}) rotateY(${drift * (1 - pull)}deg)`,
					transformOrigin: `${BEZEL + fx * PHONE_W}px ${BEZEL + fy * SCREEN_H}px`,
					filter: `blur(${exit * 10}px)`,
				}}
			>
				<Phone width={PHONE_W} overlay={<AbsoluteFill><Screen /></AbsoluteFill>}>
					<div />
				</Phone>
			</div>
		</AbsoluteFill>
	);
};

const StepTitle: React.FC<{index: number; len: number}> = ({index, len}) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame: f, fps, config: {damping: 20, stiffness: 160}});
	const out = interpolate(f, [len - 8, len], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{alignItems: 'center', paddingTop: 118, opacity: 1 - out, filter: `blur(${out * 8}px)`}}>
			<div style={{fontFamily: SANS, fontSize: 28, fontWeight: 700, letterSpacing: 8, color: C.tealBright, marginBottom: 18, opacity: s}}>
				{String(index + 1).padStart(2, '0')}
			</div>
			<Word at={2} size={112} italic>
				{STEPS[index].title}
			</Word>
		</AbsoluteFill>
	);
};

const Titles: React.FC = () => {
	const {zoom} = useCamera();
	// The phone grows over the title on a push-in; let the title step back.
	const o = interpolate(zoom, [1, 1.3], [1, 0.25], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{opacity: o}}>
			{STEPS.map((s, i) => (
				<Sequence key={i} from={starts[i]} durationInFrames={stepFrames(s)}>
					<StepTitle index={i} len={stepFrames(s)} />
				</Sequence>
			))}
		</AbsoluteFill>
	);
};

const Progress: React.FC = () => {
	const f = useCurrentFrame();
	return (
		<AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 34}}>
			<div style={{display: 'flex', gap: 10}}>
				{STEPS.map((s, i) => {
					const a = starts[i];
					const b = a + stepFrames(s);
					const fill = interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
					const show = interpolate(f, [INTRO - 10, INTRO, TUTORIAL_DURATION - OUTRO, TUTORIAL_DURATION - OUTRO + 10], [0, 1, 1, 0], {
						extrapolateLeft: 'clamp',
						extrapolateRight: 'clamp',
					});
					return (
						<div key={i} style={{width: 74, height: 5, borderRadius: 4, background: 'rgba(255,255,255,0.14)', overflow: 'hidden', opacity: show}}>
							<div style={{width: `${fill * 100}%`, height: '100%', background: C.ink}} />
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

const Intro: React.FC = () => {
	const f = useCurrentFrame();
	const exit = interpolate(f, [INTRO - 14, INTRO], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', textAlign: 'center', opacity: 1 - exit, filter: `blur(${exit * 10}px)`}}>
			<div>
				<Word at={0} size={150}>
					achte biyè w
				</Word>
			</div>
			<div>
				<Word at={8} size={150} italic color={C.tealBright}>
					sou Tikèm.
				</Word>
			</div>
			<div style={{height: 36}} />
			<Word at={20} size={48} color={C.muted} style={{fontFamily: SANS, fontWeight: 500, letterSpacing: 0}}>
				7 etap, mwens pase yon minit
			</Word>
		</AbsoluteFill>
	);
};

const Outro: React.FC = () => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame: f, fps, config: {damping: 16, stiffness: 120}});
	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', textAlign: 'center'}}>
			<div
				style={{
					fontFamily: SERIF_ITALIC,
					fontSize: 260,
					letterSpacing: -6,
					color: C.ink,
					opacity: s,
					transform: `scale(${interpolate(s, [0, 1], [0.88, 1])})`,
					filter: `blur(${(1 - s) * 12}px)`,
				}}
			>
				tik<span style={{color: C.tealBright}}>è</span>m
			</div>
			<div style={{height: 30}} />
			<Word at={10} size={46} color={C.ink} style={{fontFamily: SANS, fontWeight: 600, letterSpacing: 0}}>
				App Store · Google Play
			</Word>
			<div style={{height: 14}} />
			<Word at={16} size={40} color={C.muted} style={{fontFamily: SANS, fontWeight: 500, letterSpacing: 0}}>
				tikem.co
			</Word>
			<AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 70}}>
				<div style={{fontFamily: SANS, fontSize: 22, color: 'rgba(244,241,234,0.4)', opacity: s}}>
					Mizik: « Dechire Langyet », Zoedjobeatz (CC BY-SA)
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

export const TikemTutorialFilm: React.FC = () => {
	const {durationInFrames} = useVideoConfig();
	const f = useCurrentFrame();
	const vol = interpolate(f, [0, 20, durationInFrames - 40, durationInFrames], [0, 0.55, 0.55, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return (
		<AbsoluteFill style={{background: C.bg}}>
			<Backdrop glow={0.8} />
			<Audio src={staticFile('music.mp3')} startFrom={MUSIC_START} volume={vol} />
			<Sequence durationInFrames={INTRO}>
				<Intro />
			</Sequence>
			<Titles />
			<PhoneStage />
			<Sequence from={TUTORIAL_DURATION - OUTRO}>
				<Outro />
			</Sequence>
			<Progress />
		</AbsoluteFill>
	);
};
