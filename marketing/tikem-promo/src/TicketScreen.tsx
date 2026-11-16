import React from 'react';
import {Img, staticFile} from 'remotion';
import {SANS, SERIF} from './theme';

// Mirrors mobile/screens/TicketDetailScreen.tsx + components/TicketQRCard.tsx (sizes in points).
// Filled with SAMPLE data for marketing; it is not a real ticket.
const col = {
	background: '#0A0A0A',
	surface: '#161616',
	surfaceRaised: '#1F1F1F',
	border: '#262626',
	text: '#FFFFFF',
	textSecondary: '#A3A3A3',
	primary: '#14B8A6',
};

const Icon: React.FC<{d: React.ReactNode; size?: number; color?: string}> = ({d, size = 20, color = col.primary}) => (
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		{d}
	</svg>
);

const I = {
	back: <path d="m15 18-6-6 6-6" />,
	send: (
		<>
			<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
			<path d="m21.854 2.147-10.94 10.939" />
		</>
	),
	calendar: (
		<>
			<path d="M8 2v4" />
			<path d="M16 2v4" />
			<rect width="18" height="18" x="3" y="4" rx="2" />
			<path d="M3 10h18" />
		</>
	),
	pin: (
		<>
			<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
			<circle cx="12" cy="10" r="3" />
		</>
	),
	user: (
		<>
			<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</>
	),
	calendarPlus: (
		<>
			<path d="M8 2v4" />
			<path d="M16 2v4" />
			<path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
			<path d="M3 10h18" />
			<path d="M16 19h6" />
			<path d="M19 16v6" />
		</>
	),
	nav: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
};

const InfoCard: React.FC<{icon: React.ReactNode; label: string; value: string; sub: string}> = ({icon, label, value, sub}) => (
	<div
		style={{
			display: 'flex',
			background: col.surface,
			padding: 16,
			borderRadius: 16,
			border: `1px solid ${col.border}`,
		}}
	>
		<div
			style={{
				width: 40,
				height: 40,
				borderRadius: 20,
				background: 'rgba(20,184,166,0.08)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				marginRight: 12,
				flexShrink: 0,
			}}
		>
			<Icon d={icon} />
		</div>
		<div>
			<div style={{fontSize: 11, color: col.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8}}>{label}</div>
			<div style={{fontSize: 14, letterSpacing: 0.3, color: col.text, marginBottom: 2}}>{value}</div>
			<div style={{fontSize: 12, letterSpacing: 0.3, color: col.textSecondary}}>{sub}</div>
		</div>
	</div>
);

/** A tap: soft light that swells and fades. 0 = no press. */
const pressStyle = (p: number): React.CSSProperties =>
	p > 0 ? {transform: `scale(${1 - 0.03 * Math.sin(Math.PI * p)})`, filter: `brightness(${1 + 0.25 * Math.sin(Math.PI * p)})`} : {};

export const TicketScreen: React.FC<{scrollY?: number; pressTransfer?: number; pressWallet?: number}> = ({
	scrollY = 0,
	pressTransfer = 0,
	pressWallet = 0,
}) => (
	<div style={{position: 'relative', width: 402, height: 874, background: col.background, overflow: 'hidden', fontFamily: SANS, color: col.text}}>
		<div style={{position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${-scrollY}px)`}}>
			<div style={{padding: 20, paddingTop: 62}}>
				{/* header */}
				<div style={{marginLeft: -6, marginBottom: 8}}>
					<Icon d={I.back} size={24} color={col.text} />
				</div>
				<div style={{fontFamily: SERIF, fontSize: 28, lineHeight: '30px', marginBottom: 16}}>NWIT KONPA LIVE</div>

				{/* status chip */}
				<div style={{display: 'flex', justifyContent: 'center', marginBottom: 20}}>
					<div
						style={{
							padding: '5px 12px',
							borderRadius: 999,
							background: 'rgba(20,184,166,0.16)',
							border: '1px solid rgba(20,184,166,0.32)',
							color: '#2DD4BF',
							fontSize: 12,
							fontWeight: 700,
							letterSpacing: 1,
						}}
					>
						ACTIVE
					</div>
				</div>

				{/* white ticket */}
				<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32}}>
					<div
						style={{
							background: '#fff',
							borderRadius: 20,
							padding: 24,
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
						}}
					>
						<div style={{fontSize: 22, fontWeight: 800, color: '#000', letterSpacing: -0.3, lineHeight: '27px', textAlign: 'center'}}>
							NWIT KONPA LIVE
						</div>
						<div style={{fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.6)', marginTop: 4}}>Sat, Oct 24 · 9:00 PM</div>
						<div style={{padding: 16, borderRadius: 16, marginTop: 24, background: '#fff'}}>
							<Img src={staticFile('ticket_qr.png')} style={{width: 200, height: 200, display: 'block'}} />
						</div>
						<div style={{fontSize: 14, fontWeight: 700, color: '#000', marginTop: 16}}>General Admission</div>
						<div style={{fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.6)', marginTop: 2}}>Admit: Nadège P.</div>
						<div style={{fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginTop: 12, letterSpacing: 0.5}}>Order #8F3K2Q</div>
					</div>
					<div style={{fontSize: 15, color: col.textSecondary, fontWeight: 500, textAlign: 'center', marginTop: 16}}>
						Present this code to venue staff for entry
					</div>
				</div>

				{/* transfer */}
				<div
					style={{
						background: col.primary,
						padding: 18,
						borderRadius: 16,
						marginBottom: 32,
						boxShadow: '0 6px 12px rgba(20,184,166,0.35)',
						display: 'flex',
						alignItems: 'center',
						...pressStyle(pressTransfer),
					}}
				>
					<div
						style={{
							width: 48,
							height: 48,
							borderRadius: 12,
							background: 'rgba(255,255,255,0.2)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							marginRight: 14,
						}}
					>
						<Icon d={I.send} size={22} color="#fff" />
					</div>
					<div>
						<div style={{fontSize: 18, fontWeight: 700, marginBottom: 3}}>Transfer Ticket</div>
						<div style={{fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: 500}}>Send this ticket to someone else</div>
					</div>
				</div>

				{/* info cards */}
				<div style={{display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24}}>
					<InfoCard icon={I.calendar} label="Date & Time" value="Oct 24, 2026" sub="9:00 PM" />
					<InfoCard icon={I.pin} label="Venue" value="Place Boyer" sub="Pétion-Ville" />
					<InfoCard icon={I.user} label="Attendee" value="Nadège P." sub="nadege@tikem.co" />
				</div>

				{/* wallet + post-purchase */}
				<div style={{marginBottom: 24}}>
					<div
						style={{
							height: 52,
							borderRadius: 12,
							background: '#000',
							border: '1px solid #3a3a3a',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							gap: 10,
							fontSize: 16,
							fontWeight: 600,
							...pressStyle(pressWallet),
						}}
					>
						<svg width="26" height="20" viewBox="0 0 26 20">
							<rect x="0" y="0" width="26" height="20" rx="4" fill="#fff" />
							<rect x="2" y="3" width="22" height="4" rx="1" fill="#2DAEEB" />
							<rect x="2" y="6" width="22" height="4" rx="1" fill="#F2B233" />
							<rect x="2" y="9" width="22" height="4" rx="1" fill="#E8463C" />
							<rect x="2" y="12" width="22" height="6" rx="1.5" fill="#1C1C1E" />
						</svg>
						Add to Apple Wallet
					</div>
					<div style={{display: 'flex', gap: 12, marginTop: 12}}>
						{[
							[I.calendarPlus, 'Add to calendar'],
							[I.nav, 'Get directions'],
						].map(([icon, label], i) => (
							<div
								key={i}
								style={{
									flex: 1,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									gap: 8,
									padding: '14px 0',
									borderRadius: 14,
									background: col.surfaceRaised,
									fontSize: 14,
									fontWeight: 600,
								}}
							>
								<Icon d={icon} size={18} color={col.text} />
								{label as string}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
		{/* real status bar (from a simulator capture), pinned like the OS */}
		<Img
			src={staticFile('statusbar.png')}
			style={{position: 'absolute', top: 0, left: 0, width: 402, height: 50, background: col.background}}
		/>
	</div>
);
