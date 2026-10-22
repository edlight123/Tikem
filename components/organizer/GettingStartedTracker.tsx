'use client';

import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

interface Step {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  href: string;
  ctaLabel: string;
}

interface GettingStartedTrackerProps {
  hasCreatedEvent: boolean;
  isVerified: boolean;
  hasPayoutSetup: boolean;
}

export default function GettingStartedTracker({
  hasCreatedEvent,
  isVerified,
  hasPayoutSetup,
}: GettingStartedTrackerProps) {
  const { t } = useTranslation();

  const steps: Step[] = [
    {
      id: 'create-event',
      title: t('organizer.gettingStarted.createEvent', 'Create Your First Event'),
      description: t(
        'organizer.gettingStarted.createEventDesc',
        'Set up your event with details, tickets, and pricing'
      ),
      completed: hasCreatedEvent,
      href: '/organizer/events/new',
      ctaLabel: t('organizer.gettingStarted.createEventCta', 'Create Event'),
    },
    {
      id: 'verify',
      title: t('organizer.gettingStarted.getVerified', 'Get Verified'),
      description: t(
        'organizer.gettingStarted.getVerifiedDesc',
        'Verify your identity to unlock ticket sales'
      ),
      completed: isVerified,
      href: '/organizer/verify',
      ctaLabel: t('organizer.gettingStarted.getVerifiedCta', 'Start Verification'),
    },
    {
      id: 'payout',
      title: t('organizer.gettingStarted.setupPayouts', 'Set Up Payouts'),
      description: t(
        'organizer.gettingStarted.setupPayoutsDesc',
        'Add your bank or mobile money to receive earnings'
      ),
      completed: hasPayoutSetup,
      href: '/organizer/settings/payouts',
      ctaLabel: t('organizer.gettingStarted.setupPayoutsCta', 'Add Payout Method'),
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progressPercent = (completedCount / steps.length) * 100;

  // Find the next incomplete step
  const nextStep = steps.find((s) => !s.completed);

  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.03] shadow-sm">
      {/* Header — the rule below divides two stacked regions, so it earns its keep. */}
      <div className="border-b border-white/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-[22px] italic lowercase leading-none text-white">
              {t('organizer.gettingStarted.title', 'Getting Started')}
            </h2>
            <p className="text-sm text-white/50 mt-1">
              {completedCount === steps.length
                ? t('organizer.gettingStarted.allComplete', "You're all set!")
                : t('organizer.gettingStarted.progress', '{{completed}} of {{total}} steps complete', {
                    completed: completedCount,
                    total: steps.length,
                  })}
            </p>
          </div>
          <div className="text-2xl font-bold text-brand-300 font-mono tabular-nums">
            {Math.round(progressPercent)}%
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-2 overflow-hidden rounded bg-white/[0.08]">
          <div
            className="h-full rounded bg-brand-400 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-white/10">
        {steps.map((step, index) => (
          <div
            key={step.id}
            // `bg-primary-50/30` was a light-mode token that does not exist in
            // this palette, so the "do this next" row had no fill at all. The
            // next step now reads as the selected card: a real fill plus a teal
            // inset ring.
            className={`flex items-center gap-4 p-4 transition-colors ${
              nextStep?.id === step.id
                ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50'
                : 'bg-white/[0.03]'
            }`}
          >
            {/* Status Icon */}
            <div className="flex-shrink-0">
              {step.completed ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              ) : (
                <div className="relative">
                  <Circle className="w-8 h-8 text-white/50" />
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-white/50 font-mono tabular-nums">
                    {index + 1}
                  </span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <h3
                className={`font-medium ${
                  step.completed ? 'text-white/50 line-through' : 'text-white'
                }`}
              >
                {step.title}
              </h3>
              <p className="text-sm text-white/50 mt-0.5">{step.description}</p>
            </div>

            {/* Action */}
            {!step.completed && (
              <Link
                href={step.href}
                className={`inline-flex flex-shrink-0 items-center gap-1 rounded px-4 py-2 text-sm font-medium transition-colors ${
                  nextStep?.id === step.id
                    ? 'bg-white text-black hover:bg-white/90'
                    : 'bg-white/[0.07] text-white/70 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {step.ctaLabel}
                <ChevronRight className="w-4 h-4" />
              </Link>
            )}

            {step.completed && (
              <span className="flex-shrink-0 text-sm text-emerald-300 font-medium">
                {t('common.complete', 'Complete')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
