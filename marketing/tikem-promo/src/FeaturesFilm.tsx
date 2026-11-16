import React from 'react';
import {AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop, Flash, MUSIC_START, useBeatPulse, Word} from './Film';
import {Phone} from './Phone';
import {TicketScreen} from './TicketScreen';
import {b, C, SANS, SERIF_ITALIC} from './theme';

// "Sa Tikèm ka fè": feature tour, beat-locked like the product film.
export const FEATURES_DURATION = b(78);

const PHONE_W = 540;

const Chip: React.FC<{children: React.ReactNode}> = ({children}) => (
	<div
		style={{
			fontFamily: SANS,
			fontSize: 26,
			fontWeight: 700,
			letterSpacing: 6,
			color: C.tealBright,
			textTransform: 'uppercase',
			marginBottom: 22,
		}}
	>
		{children}
	</div>
);

/** One feature: section chip + headline + subline on top, phone below. */
const Feature: React.FC<{
	chip: string;
	title: React.ReactNode;
	sub: string;
	phone: React.ReactNode;
	tiltFrom?: number;
	tiltTo?: number;
}> = ({chip, title, sub, phone, tiltFrom = -10, tiltTo = 10}) => {
	const f = useCurrentFrame();
	const {fps, durationInFrames} = useVideoConfig();
	const rise = spring({frame: f, fps, config: {damping: 20, stiffness: 110}});
	const tilt = interpolate(f, [0, durationInFrames], [tiltFrom, tiltTo]);
	return (
		<AbsoluteFill>
			<Backdrop />
			<AbsoluteFill style={{alignItems: 'center', paddingTop: 140, textAlign: 'center', paddingLeft: 60, paddingRight: 60}}>
				<Chip>{chip}</Chip>
				<Word at={2} size={124}>
					{title}
				</Word>
				<div style={{height: 18}} />
				<Word at={b(1)} size={52} color={C.muted}>
					{sub}
				</Word>
			</AbsoluteFill>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', perspective: 1800}}>
				<div
					style={{
						transform: `translateY(${(1 - rise) * 700 - 130}px) rotateY(${tilt}deg) rotateX(6deg)`,
					}}
				>
					{phone}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/** Ticket screen that scrolls and gets tapped on cue (frames relative to its Sequence). */
const TicketPhone: React.FC<{keys: [number, number][]; transferTap?: number; walletTap?: number}> = ({keys, transferTap, walletTap}) => {
	const f = useCurrentFrame();
	const frames = keys.map((k) => k[0]);
	const ys = keys.map((k) => k[1]);
	const scrollY = interpolate(f, frames, ys, {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: Easing.inOut(Easing.cubic),
	});
	const press = (at?: number) => (at === undefined ? 0 : interpolate(f, [at, at + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) % 1);
	return (
		<Phone width={PHONE_W}>
			<TicketScreen scrollY={scrollY} pressTransfer={press(transferTap)} pressWallet={press(walletTap)} />
		</Phone>
	);
};

const Languages: React.FC = () => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const swap = interpolate(f, [b(3), b(3) + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const rise = spring({frame: f, fps, config: {damping: 20, stiffness: 110}});
	const active = swap > 0.5 ? 'HT' : 'EN';
	return (
		<AbsoluteFill>
			<Backdrop />
			<AbsoluteFill style={{alignItems: 'center', paddingTop: 140, textAlign: 'center'}}>
				<Chip>pou ou</Chip>
				<Word at={2} size={124}>
					nan lang ou.
				</Word>
				<div style={{height: 40}} />
				<div style={{display: 'flex', gap: 18, opacity: rise}}>
					{['EN', 'FR', 'HT'].map((l) => (
						<div
							key={l}
							style={{
								fontFamily: SANS,
								fontWeight: 700,
								fontSize: 40,
								padding: '14px 34px',
								borderRadius: 999,
								background: l === active ? C.ink : 'rgba(255,255,255,0.08)',
								color: l === active ? '#000' : C.muted,
							}}
						>
							{l}
						</div>
					))}
				</div>
			</AbsoluteFill>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 230}}>
				<div
					style={{
						position: 'relative',
						width: 900,
						height: (900 * 780) / 1206,
						borderRadius: 48,
						overflow: 'hidden',
						boxShadow: '0 60px 120px rgba(0,0,0,0.7), 0 0 100px rgba(20,184,166,0.16)',
						transform: `translateY(${(1 - rise) * 500}px)`,
					}}
				>
					<Img src={staticFile('lang_en.png')} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover'}} />
					<Img
						src={staticFile('lang_ht.png')}
						style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', clipPath: `inset(0 ${(1 - swap) * 100}% 0 0)`}}
					/>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const SectionTitle: React.FC = () => (
	<AbsoluteFill>
		<Backdrop glow={1.3} />
		<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
			<Word at={0} size={90} color={C.muted}>
				e pou
			</Word>
			<Word at={b(1)} size={190} italic color={C.tealBright}>
				òganizatè yo.
			</Word>
		</AbsoluteFill>
		<Sequence durationInFrames={10}>
			<Flash />
		</Sequence>
	</AbsoluteFill>
);

const OrganizerTools: React.FC = () => {
	const items = ['kreye evènman an kèk minit', 'kòd promo ak lyen pwomotè', 'ekip pòt ak eskanè tikè', 'lis envite ak ranbousman'];
	const pulse = useBeatPulse(0.015);
	return (
		<AbsoluteFill>
			<Backdrop glow={0.7} />
			<AbsoluteFill style={{justifyContent: 'center', paddingLeft: 90, paddingRight: 70, transform: `scale(${pulse})`}}>
				<Chip>pou òganizatè</Chip>
				{items.map((t, i) => (
					<div key={t} style={{display: 'flex', alignItems: 'baseline', gap: 26, marginBottom: 30}}>
						<Word at={b(i * 1.5)} size={52} color={C.tealBright} style={{fontFamily: SANS, fontWeight: 700}}>
							{String(i + 1).padStart(2, '0')}
						</Word>
						<Word at={b(i * 1.5)} size={92}>
							{t}
						</Word>
					</div>
				))}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const End: React.FC = () => {
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
				<Word at={b(1)} size={80}>
					tout sa, nan yon sèl app.
				</Word>
				<div style={{height: 70}} />
				<Word at={b(2)} size={44} style={{fontFamily: SANS, fontWeight: 600, letterSpacing: 10}} color={C.tealBright}>
					TIKEM.CO
				</Word>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

export const TikemFeaturesFilm: React.FC = () => {
	const {durationInFrames} = useVideoConfig();
	const seg = (from: number, to: number, node: React.ReactNode) => (
		<Sequence from={b(from)} durationInFrames={b(to) - b(from)}>
			{node}
		</Sequence>
	);
	return (
		<AbsoluteFill style={{background: C.bg}}>
			{seg(
				0,
				8,
				<AbsoluteFill>
					<Backdrop glow={0.7} />
					<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
						<Word at={0} size={170}>
							sa Tikèm
						</Word>
						<Word at={b(1)} size={170} italic color={C.tealBright}>
							ka fè.
						</Word>
						<div style={{height: 50}} />
						<Word at={b(3)} size={54} color={C.muted}>
							pou ou · pou òganizatè
						</Word>
					</AbsoluteFill>
				</AbsoluteFill>,
			)}
			{seg(
				8,
				16,
				<Feature
					chip="pou ou"
					title="jwenn fèt ou."
					sub="mizik · lavi lannwit · kilti · toupre ou"
					phone={<Phone src="app_home.mp4" width={PHONE_W} />}
				/>,
			)}
			{seg(
				16,
				24,
				<Feature
					chip="pou ou"
					title={
						<>
							peye ak <span style={{fontFamily: SERIF_ITALIC, color: C.tealBright}}>MonCash.</span>
						</>
					}
					sub="an goud, dirèk nan app la"
					phone={
						<div style={{position: 'relative'}}>
							<Sequence durationInFrames={b(4)} layout="none">
								<Phone src="app_tickets.mp4" width={PHONE_W} startFrom={126} />
							</Sequence>
							<Sequence from={b(4)} layout="none">
								<Phone src="app_pay.mp4" width={PHONE_W} startFrom={18} />
							</Sequence>
						</div>
					}
				/>,
			)}
			{seg(
				24,
				34,
				<Feature
					chip="pou ou"
					title="tikè ou, nan telefòn ou."
					sub="kòd QR · Apple Wallet · kalandriye"
					phone={<TicketPhone keys={[[0, 0], [b(5), 0], [b(6.5), 360]]} walletTap={b(8)} />}
				/>,
			)}
			{seg(
				34,
				42,
				<AbsoluteFill>
					<Feature
						chip="pou ou"
						title="voye l bay yon zanmi."
						sub="transfere tikè ou an kèk segonn"
						phone={<TicketPhone keys={[[0, 360], [b(1.5), 300]]} transferTap={b(3)} />}
						tiltFrom={10}
						tiltTo={-8}
					/>
					<Sequence durationInFrames={10}>
						<Flash />
					</Sequence>
				</AbsoluteFill>,
			)}
			{seg(42, 48, <Languages />)}
			{seg(48, 52, <SectionTitle />)}
			{seg(
				52,
				60,
				<AbsoluteFill>
					<Feature
						chip="pou òganizatè"
						title="lavant ou, an dirèk."
						sub="lajan, tikè, evènman: tout an tan reyèl"
						phone={<Phone src="app_dashboard.mp4" width={PHONE_W} playbackRate={1.1} />}
					/>
					<div style={{position: 'absolute', right: 50, bottom: 40, fontFamily: SANS, fontSize: 24, letterSpacing: 3, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase'}}>
						Illustrative data
					</div>
				</AbsoluteFill>,
			)}
			{seg(60, 68, <OrganizerTools />)}
			<Sequence from={b(68)}>
				<End />
			</Sequence>
			<Audio
				src={staticFile('music.mp3')}
				startFrom={MUSIC_START}
				volume={(fr) => interpolate(fr, [durationInFrames - 45, durationInFrames], [1, 0], {extrapolateLeft: 'clamp'})}
			/>
		</AbsoluteFill>
	);
};
