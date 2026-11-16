import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Easing,
	Img,
	interpolate,
	OffthreadVideo,
	Sequence,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {Phone} from './Phone';
import {b, C, SANS, SERIF, SERIF_ITALIC} from './theme';

// Music: "Dechire Langyet" by Zoedjobeatz (CC BY-SA). 48.545s is a downbeat.
export const MUSIC_START = Math.round(48.545 * 30);

// ---------- building blocks ----------

export const Backdrop: React.FC<{glow?: number}> = ({glow = 1}) => {
	const f = useCurrentFrame();
	const x = 50 + Math.sin(f / 70) * 12;
	const y = 42 + Math.cos(f / 90) * 8;
	return (
		<AbsoluteFill
			style={{
				background: `radial-gradient(circle at ${x}% ${y}%, rgba(20,184,166,${0.22 * glow}) 0%, rgba(20,184,166,0) 46%), ${C.bg}`,
			}}
		/>
	);
};

/** A word that lands on its beat: rises, sharpens and fades in. */
export const Word: React.FC<{
	at: number;
	children: React.ReactNode;
	style?: React.CSSProperties;
	italic?: boolean;
	color?: string;
	size?: number;
}> = ({at, children, style, italic, color = C.ink, size = 170}) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame: f - at, fps, config: {damping: 18, stiffness: 180, mass: 0.7}});
	const blur = interpolate(s, [0, 1], [14, 0]);
	return (
		<span
			style={{
				display: 'inline-block',
				fontFamily: italic ? SERIF_ITALIC : SERIF,
				fontSize: size,
				lineHeight: 0.98,
				letterSpacing: -2,
				color,
				opacity: s,
				transform: `translateY(${(1 - s) * 60}px)`,
				filter: `blur(${blur}px)`,
				...style,
			}}
		>
			{children}
		</span>
	);
};

/** Small scale kick on every beat, decaying fast. */
export const useBeatPulse = (amount = 0.02) => {
	const f = useCurrentFrame();
	const beatLen = 14.4;
	const phase = (f % beatLen) / beatLen;
	return 1 + amount * Math.exp(-phase * 7);
};

export const Flash: React.FC<{dur?: number}> = ({dur = 8}) => {
	const f = useCurrentFrame();
	const o = interpolate(f, [0, dur], [0.85, 0], {extrapolateRight: 'clamp'});
	return <AbsoluteFill style={{background: '#fff', opacity: o}} />;
};

// ---------- scenes ----------

const Hook: React.FC = () => {
	const f = useCurrentFrame();
	const exit = interpolate(f, [b(6.5), b(8)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<AbsoluteFill>
			<Backdrop glow={0.6} />
			<AbsoluteFill
				style={{
					justifyContent: 'center',
					alignItems: 'center',
					textAlign: 'center',
					opacity: 1 - exit,
					transform: `translateY(${-exit * 120}px)`,
					filter: `blur(${exit * 10}px)`,
				}}
			>
				<div>
					<Word at={0}>tikè&nbsp;</Word>
					<Word at={b(1)}>pou</Word>
				</div>
				<div>
					<Word at={b(2)}>tout fèt</Word>
				</div>
				<div>
					<Word at={b(3)} italic color={C.tealBright}>
						Ayiti yo.
					</Word>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const STEP_PHONE_W = 560;

const StepPhone: React.FC<{src: string; startFrom?: number; tilt: number}> = ({src, startFrom = 0, tilt}) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const kick = spring({frame: f, fps, config: {damping: 14, stiffness: 220}});
	const scale = interpolate(kick, [0, 1], [0.94, 1]);
	return (
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 120, perspective: 1800}}>
			<div style={{transform: `rotateY(${tilt}deg) rotateX(6deg) scale(${scale})`, transformStyle: 'preserve-3d'}}>
				<Phone src={src} width={STEP_PHONE_W} startFrom={startFrom} />
			</div>
		</AbsoluteFill>
	);
};

const Steps: React.FC = () => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const rise = spring({frame: f, fps, config: {damping: 20, stiffness: 90}});
	const tilt = interpolate(f, [0, b(16)], [-16, 12]);
	const headline = (at: number, end: number, node: React.ReactNode) => (
		<Sequence from={at} durationInFrames={end - at} layout="none">
			<AbsoluteFill style={{alignItems: 'center', paddingTop: 170, textAlign: 'center'}}>{node}</AbsoluteFill>
		</Sequence>
	);
	return (
		<AbsoluteFill>
			<Backdrop />
			<AbsoluteFill style={{transform: `translateY(${(1 - rise) * 1300}px)`}}>
				<Sequence durationInFrames={b(4)}>
					<StepPhone src="app_home.mp4" tilt={tilt} />
				</Sequence>
				<Sequence from={b(4)} durationInFrames={b(4)}>
					<StepPhone src="app_event.mp4" tilt={tilt} />
				</Sequence>
				<Sequence from={b(8)} durationInFrames={b(3.5)}>
					<StepPhone src="app_tickets.mp4" startFrom={126} tilt={tilt} />
				</Sequence>
				<Sequence from={b(11.5)} durationInFrames={b(16) - b(11.5)}>
					<StepPhone src="app_pay.mp4" tilt={tilt} />
				</Sequence>
			</AbsoluteFill>
			{headline(0, b(4), <Word at={4} size={200}>jwenn.</Word>)}
			{headline(b(4), b(8), <Word at={0} size={200}>chwazi.</Word>)}
			{headline(
				b(8),
				b(16),
				<div>
					<Word at={0} size={200}>peye</Word>
					<br />
					<Word at={b(1)} size={130} italic color={C.tealBright}>
						ak MonCash.
					</Word>
				</div>,
			)}
		</AbsoluteFill>
	);
};

const Enter: React.FC = () => {
	const f = useCurrentFrame();
	const zoom = interpolate(f, [0, b(6)], [1.12, 1.0], {easing: Easing.out(Easing.cubic)});
	return (
		<AbsoluteFill style={{background: C.bg}}>
			<AbsoluteFill style={{transform: `scale(${zoom})`}}>
				<OffthreadVideo src={staticFile('gate.mp4')} startFrom={12} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
			</AbsoluteFill>
			<AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 22%, rgba(0,0,0,0) 40%)'}} />
			<AbsoluteFill style={{alignItems: 'center', paddingTop: 170, textAlign: 'center'}}>
				<Word at={2} size={210}>antre.</Word>
				<div style={{marginTop: 18}}>
					<Word at={b(1.5)} size={64} color={C.muted}>tikè ou, nan telefòn ou.</Word>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const Features: React.FC = () => {
	const lines: [number, React.ReactNode][] = [
		[0, <>MonCash <span style={{fontFamily: SERIF_ITALIC, color: C.tealBright}}>ak</span> kat.</>],
		[b(1.33), <>tikè nan telefòn ou.</>],
		[b(2.66), <>Kreyòl · Français · English</>],
	];
	return (
		<AbsoluteFill>
			<Backdrop glow={0.4} />
			<AbsoluteFill style={{justifyContent: 'center', paddingLeft: 90}}>
				{lines.map(([at, node], i) => (
					<div key={i} style={{marginBottom: 34}}>
						<Word at={at} size={i === 2 ? 74 : 112} color={i === 2 ? C.muted : C.ink}>
							{node}
						</Word>
					</div>
				))}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const POSTERS = ['nwit.jpg', 'mizik.jpg', 'rooftop.jpg', 'lannwit.jpg', 'nearyou.jpg'];

const PosterColumn: React.FC<{offset: number; speed: number; x: number}> = ({offset, speed, x}) => {
	const f = useCurrentFrame();
	const tileH = 420;
	const gap = 30;
	const y = -((f * speed + offset) % (tileH + gap)) - 200;
	return (
		<div style={{position: 'absolute', left: x, top: y, display: 'flex', flexDirection: 'column', gap}}>
			{Array.from({length: 9}).map((_, i) => (
				<Img
					key={i}
					src={staticFile(`posters/${POSTERS[(i + Math.round(offset)) % POSTERS.length]}`)}
					style={{width: 320, height: tileH, objectFit: 'cover', borderRadius: 26, boxShadow: '0 20px 50px rgba(0,0,0,0.6)'}}
				/>
			))}
		</div>
	);
};

const Wall: React.FC = () => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const pulse = useBeatPulse(0.025);
	const inP = spring({frame: f, fps, config: {damping: 18, stiffness: 120}});
	return (
		<AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
			<AbsoluteFill style={{perspective: 1600}}>
				<div
					style={{
						position: 'absolute',
						left: -380,
						top: -200,
						width: 1900,
						height: 2600,
						transform: `rotateX(28deg) rotateZ(-14deg) scale(${1.1 * pulse})`,
						opacity: 0.55,
					}}
				>
					{[0, 1, 2, 3, 4].map((i) => (
						<PosterColumn key={i} x={i * 360} offset={i * 137} speed={i % 2 ? 5.5 : 3.6} />
					))}
				</div>
			</AbsoluteFill>
			<AbsoluteFill style={{background: 'radial-gradient(circle at 50% 50%, rgba(5,5,5,0) 0%, rgba(5,5,5,0.85) 75%)'}} />
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', perspective: 1800}}>
				<div style={{transform: `translateY(${(1 - inP) * 900 + 60}px) rotateY(${interpolate(f, [0, b(12)], [10, -10])}deg) scale(${pulse})`}}>
					<Phone src="app_home.mp4" width={500} startFrom={45} />
				</div>
			</AbsoluteFill>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 140, textAlign: 'center'}}>
				<Word at={b(1)} size={150}>tout fèt yo.</Word>
				<Word at={b(3)} size={120} italic color={C.tealBright}>
					yon sèl kote.
				</Word>
			</AbsoluteFill>
			<Sequence durationInFrames={10}>
				<Flash />
			</Sequence>
		</AbsoluteFill>
	);
};

const Organizers: React.FC = () => {
	const f = useCurrentFrame();
	const tilt = interpolate(f, [0, b(8)], [14, -8]);
	return (
		<AbsoluteFill>
			<Backdrop glow={0.8} />
			<AbsoluteFill style={{alignItems: 'center', paddingTop: 150, textAlign: 'center'}}>
				<Word at={0} size={72} color={C.muted}>w ap òganize yon fèt?</Word>
				<div style={{height: 20}} />
				<Word at={b(1)} size={150}>vann tikè ou</Word>
				<Word at={b(2)} size={130} italic color={C.tealBright}>
					sou Tikèm.
				</Word>
			</AbsoluteFill>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 60, perspective: 1800}}>
				<div style={{transform: `rotateY(${tilt}deg) rotateX(8deg)`}}>
					<Phone src="app_dashboard.mp4" width={520} playbackRate={1.15} />
				</div>
			</AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					right: 50,
					bottom: 40,
					fontFamily: SANS,
					fontSize: 24,
					letterSpacing: 3,
					color: 'rgba(255,255,255,0.55)',
					textTransform: 'uppercase',
				}}
			>
				Illustrative data
			</div>
		</AbsoluteFill>
	);
};

const EndCard: React.FC = () => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const s = spring({frame: f, fps, config: {damping: 16, stiffness: 120}});
	return (
		<AbsoluteFill>
			<Backdrop glow={1.2} />
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
				<div
					style={{
						fontFamily: SERIF_ITALIC,
						fontSize: 290,
						letterSpacing: -6,
						color: C.ink,
						transform: `scale(${interpolate(s, [0, 1], [0.86, 1])})`,
						opacity: s,
						filter: `blur(${(1 - s) * 12}px)`,
					}}
				>
					tik<span style={{color: C.teal}}>è</span>m
				</div>
				<div style={{height: 10}} />
				<Word at={b(1)} size={86}>antre nan fèt la.</Word>
				<div style={{height: 70}} />
				<Word at={b(2)} size={44} style={{fontFamily: SANS, fontWeight: 600, letterSpacing: 10}} color={C.tealBright}>
					TIKEM.CO
				</Word>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// ---------- the film ----------

export const TikemProductFilm: React.FC = () => {
	const {durationInFrames} = useVideoConfig();
	return (
		<AbsoluteFill style={{background: C.bg}}>
			<Sequence durationInFrames={b(8)}>
				<Hook />
			</Sequence>
			<Sequence from={b(8)} durationInFrames={b(24) - b(8)}>
				<Steps />
			</Sequence>
			<Sequence from={b(24)} durationInFrames={b(30) - b(24)}>
				<Enter />
			</Sequence>
			<Sequence from={b(30)} durationInFrames={b(34) - b(30)}>
				<Features />
			</Sequence>
			<Sequence from={b(34)} durationInFrames={b(46) - b(34)}>
				<Wall />
			</Sequence>
			<Sequence from={b(46)} durationInFrames={b(54) - b(46)}>
				<Organizers />
			</Sequence>
			<Sequence from={b(54)}>
				<EndCard />
			</Sequence>
			<Audio
				src={staticFile('music.mp3')}
				startFrom={MUSIC_START}
				volume={(f) => interpolate(f, [durationInFrames - 45, durationInFrames], [1, 0], {extrapolateLeft: 'clamp'})}
			/>
		</AbsoluteFill>
	);
};
