import React from 'react';

type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral' | 'vip' | 'trending' | 'new';
type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

// One accent only: brand teal. Variants stay distinguishable via fill vs. soft
// treatment (and semantic tokens for success/warning/error), not extra hues.
//
// These were the light theme's last holdout: `bg-*-50` is a near-white tint
// (#F0FDF4 / #FFFBEB / #FEF2F2) and `text-*-700` is near-black type — a white
// chip on a black page. `secondary` and `trending` were worse still, carrying a
// pale `border-*-100/200` with no fill at all after a bulk find/replace ate the
// `bg-*`. kit.tsx's ChipTone was corrected for exactly this; Badge was missed.
//
// The dark equivalent of a "soft" chip is a low-alpha tint of the semantic hue
// with the BRIGHT end of that hue as the type — and no border, because the fill
// is what makes it a surface (docs/POSH_DESIGN_BRIEF.md).
const variantStyles: Record<BadgeVariant, string> = {
  // Flat, not a teal gradient: teal is semantic, never a surface.
  primary: 'bg-white/[0.08] text-white',
  secondary: 'bg-brand-500/15 text-brand-300',
  success: 'bg-success-500/15 text-success-500',
  warning: 'bg-warning-500/15 text-warning-500',
  error: 'bg-error-500/15 text-error-500',
  neutral: 'bg-white/[0.06] text-white/70',
  vip: 'bg-amber-400/[0.12] text-amber-200',
  trending: 'bg-brand-500/15 text-brand-300',
  new: 'bg-success-500/15 text-success-500',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs rounded-md',
  md: 'px-3 py-1 text-sm rounded-lg',
  lg: 'px-4 py-1.5 text-base rounded-xl',
};

export default function Badge({
  variant = 'neutral',
  size = 'md',
  icon,
  children,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-semibold
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}
