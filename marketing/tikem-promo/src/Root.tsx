import React from 'react';
import {Composition} from 'remotion';
import {TikemProductFilm} from './Film';
import {FEATURES_DURATION, TikemFeaturesFilm} from './FeaturesFilm';
import {FPS} from './theme';
import {TikemTutorialFilm, TUTORIAL_DURATION} from './TutorialFilm';

export const RemotionRoot: React.FC = () => (
	<>
		<Composition
			id="TikemProductFilm"
			component={TikemProductFilm}
			durationInFrames={30 * FPS}
			fps={FPS}
			width={1080}
			height={1920}
		/>
		<Composition
			id="TikemFeaturesFilm"
			component={TikemFeaturesFilm}
			durationInFrames={FEATURES_DURATION}
			fps={FPS}
			width={1080}
			height={1920}
		/>
		<Composition
			id="TikemTutorialFilm"
			component={TikemTutorialFilm}
			durationInFrames={TUTORIAL_DURATION}
			fps={FPS}
			width={1080}
			height={1920}
		/>
	</>
);
