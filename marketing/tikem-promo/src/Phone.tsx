import React from 'react';
import {OffthreadVideo, staticFile} from 'remotion';

// iPhone 17 Pro screen in points; screen recordings are 3x (1206x2622).
export const SCREEN_PT = {w: 402, h: 874};

// A titanium iPhone body around either a real screen recording (`src`) or a live React screen (`children`).
export const Phone: React.FC<{
	src?: string;
	width: number;
	startFrom?: number;
	playbackRate?: number;
	style?: React.CSSProperties;
	children?: React.ReactNode;
	/** Drawn over the screen (tap rings), in screen pixels. */
	overlay?: React.ReactNode;
}> = ({src, width, startFrom = 0, playbackRate = 1, style, children, overlay}) => {
	const height = (width * 2622) / 1206;
	const bezel = width * 0.035;
	const radius = width * 0.15;
	const pt = width / SCREEN_PT.w;
	return (
		<div
			style={{
				width: width + bezel * 2,
				height: height + bezel * 2,
				borderRadius: radius + bezel,
				padding: bezel,
				background: 'linear-gradient(145deg, #6b6f74 0%, #2a2c2f 22%, #17181a 50%, #3a3d41 78%, #8a8e93 100%)',
				boxShadow:
					'0 80px 160px rgba(0,0,0,0.75), 0 0 120px rgba(20,184,166,0.18), inset 0 0 0 2px rgba(255,255,255,0.08)',
				...style,
			}}
		>
			<div
				style={{
					position: 'relative',
					width,
					height,
					borderRadius: radius,
					overflow: 'hidden',
					background: '#000',
					boxShadow: 'inset 0 0 0 3px #000',
				}}
			>
				{src ? (
					<OffthreadVideo
						src={staticFile(src)}
						startFrom={startFrom}
						playbackRate={playbackRate}
						muted
						style={{width: '100%', height: '100%', objectFit: 'cover'}}
					/>
				) : (
					<div
						style={{
							width: SCREEN_PT.w,
							height: SCREEN_PT.h,
							transform: `scale(${pt})`,
							transformOrigin: 'top left',
						}}
					>
						{children}
					</div>
				)}
				{/* Dynamic Island: the simulator recording leaves this area empty */}
				<div
					style={{
						position: 'absolute',
						top: height * 0.0135,
						left: '50%',
						transform: 'translateX(-50%)',
						width: width * 0.3,
						height: height * 0.0335,
						borderRadius: 999,
						background: '#000',
					}}
				/>
				{overlay}
				{/* glass sheen */}
				<div
					style={{
						position: 'absolute',
						inset: 0,
						background: 'linear-gradient(125deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 38%)',
						pointerEvents: 'none',
					}}
				/>
			</div>
		</div>
	);
};
