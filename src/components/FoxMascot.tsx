'use client';

import React from 'react';

export type FoxMascotState = 'logo' | 'lantern' | 'alert' | 'sleeping';

interface FoxMascotProps {
  state?: FoxMascotState;
  className?: string;
  size?: number | string;
}

/**
 * Sleepy Fox mascot vector component adhering to the Warm Dark design system.
 * Renders four contextual states: logo, lantern (winding down), alert (overdue nag), and sleeping (in-bed/resting).
 *
 * @param props - Component props with state, className, and size
 * @returns React JSX SVG element
 */
export function FoxMascot({
  state = 'logo',
  className = '',
  size = 32,
}: FoxMascotProps) {
  if (state === 'logo') {
    return (
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="foxLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F4A261" />
            <stop offset="100%" stopColor="#E07A5F" />
          </linearGradient>
        </defs>
        {/* Fox Ears */}
        <path d="M12 21L7 8L20 16L12 21Z" fill="#E07A5F" />
        <path d="M11 18L8 10L17 15L11 18Z" fill="#26201B" />
        <path d="M36 21L41 8L28 16L36 21Z" fill="#E07A5F" />
        <path d="M37 18L40 10L31 15L37 18Z" fill="#26201B" />
        {/* Head */}
        <circle cx="24" cy="26" r="14" fill="url(#foxLogoGrad)" />
        {/* Cream Cheeks & Muzzle */}
        <path
          d="M14 26C16 33 21 37 24 37C27 37 32 33 34 26C31 29 27 28 24 28C21 28 17 29 14 26Z"
          fill="#F5EBE1"
        />
        {/* Sleeping Peaceful Eyes */}
        <path
          d="M17 25C18.5 27 20.5 27 22 25"
          stroke="#1C1714"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          d="M26 25C27.5 27 29.5 27 31 25"
          stroke="#1C1714"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        {/* Tiny Espresso Nose */}
        <ellipse cx="24" cy="30" rx="2" ry="1.4" fill="#1C1714" />
      </svg>
    );
  }

  if (state === 'lantern') {
    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="foxLanternGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F4A261" />
            <stop offset="100%" stopColor="#E07A5F" />
          </linearGradient>
          <radialGradient id="lanternGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E59843" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#E59843" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#E59843" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Warm Lantern Glow */}
        <circle cx="50" cy="36" r="14" fill="url(#lanternGlow)" />
        {/* Lantern */}
        <path d="M47 30H53L54 42H46L47 30Z" fill="#26201B" stroke="#E59843" strokeWidth="1.2" />
        <rect x="48" y="32" width="4" height="8" rx="1" fill="#E59843" opacity="0.9" />
        <path d="M50 25V30" stroke="#B0A295" strokeWidth="1.2" />
        {/* Fox Body */}
        <path
          d="M22 54C16 54 11 48 11 40C11 34 16 30 23 30C30 30 35 34 35 40C35 48 30 54 22 54Z"
          fill="url(#foxLanternGrad)"
        />
        {/* Ears */}
        <path d="M15 20L10 8L22 15L15 20Z" fill="#E07A5F" />
        <path d="M14 17L11 10L19 14L14 17Z" fill="#26201B" />
        <path d="M31 20L36 8L24 15L31 20Z" fill="#E07A5F" />
        <path d="M32 17L35 10L27 14L32 17Z" fill="#26201B" />
        {/* Head */}
        <circle cx="23" cy="24" r="12" fill="url(#foxLanternGrad)" />
        {/* Cream Cheeks */}
        <path
          d="M14 25C16 30 20 33 23 33C26 33 30 30 32 25C29 27 26 26.5 23 26.5C20 26.5 17 27 14 25Z"
          fill="#F5EBE1"
        />
        {/* Happy Yawning Eyes */}
        <path d="M17 23C18 24.5 20 24.5 21 23" stroke="#1C1714" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M25 23C26 24.5 28 24.5 29 23" stroke="#1C1714" strokeWidth="1.5" strokeLinecap="round" />
        {/* Cute Yawn Mouth */}
        <ellipse cx="23" cy="28" rx="2.5" ry="3.5" fill="#26201B" />
        {/* Paw holding lantern wire */}
        <path d="M33 38C38 35 44 32 49 28" stroke="#E07A5F" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  if (state === 'alert') {
    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="foxAlertGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F4A261" />
            <stop offset="100%" stopColor="#D96B52" />
          </linearGradient>
        </defs>
        {/* Alert Ears Perked Up */}
        <path d="M15 18L10 4L23 13L15 18Z" fill="#D96B52" />
        <path d="M14 15L11 7L20 12L14 15Z" fill="#26201B" />
        <path d="M33 18L38 4L25 13L33 18Z" fill="#D96B52" />
        <path d="M34 15L37 7L28 12L34 15Z" fill="#26201B" />
        {/* Head */}
        <circle cx="24" cy="24" r="13" fill="url(#foxAlertGrad)" />
        {/* Wide Alert Eyes */}
        <circle cx="19" cy="22" r="3" fill="#F5EBE1" />
        <circle cx="19.5" cy="22" r="1.5" fill="#1C1714" />
        <circle cx="29" cy="22" r="3" fill="#F5EBE1" />
        <circle cx="29.5" cy="22" r="1.5" fill="#1C1714" />
        {/* Snout & Whiskers */}
        <path
          d="M17 26C19 31 22 33 24 33C26 33 29 31 31 26C28 28 26 27.5 24 27.5C22 27.5 20 28 17 26Z"
          fill="#F5EBE1"
        />
        <ellipse cx="24" cy="28.5" rx="2" ry="1.4" fill="#1C1714" />
        {/* Fox Body */}
        <path d="M13 54C13 42 18 36 24 36C30 36 35 42 35 54H13Z" fill="url(#foxAlertGrad)" />
        {/* Tiny Ringing Bedtime Brass Bell */}
        <g className="animate-bounce">
          <path d="M46 25L52 35H40L46 25Z" fill="#E59843" stroke="#D96B52" strokeWidth="1.2" />
          <circle cx="46" cy="36" r="1.5" fill="#D96B52" />
          <path d="M46 21V25" stroke="#E59843" strokeWidth="1.5" />
          {/* Sound Vibrations */}
          <path d="M55 27C57 29 57 32 55 34" stroke="#D96B52" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M37 27C35 29 35 32 37 34" stroke="#D96B52" strokeWidth="1.2" strokeLinecap="round" />
        </g>
        {/* Arm holding bell */}
        <path d="M30 42C36 40 42 36 45 32" stroke="#D96B52" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  // state === 'sleeping'
  return (
    <svg
      viewBox="0 0 72 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="foxSleepGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F4A261" />
          <stop offset="100%" stopColor="#E07A5F" />
        </linearGradient>
      </defs>
      {/* Gentle Floating Zzz */}
      <g fill="#F5EBE1" opacity="0.8" className="animate-pulse">
        <text x="48" y="20" fontSize="11" fontWeight="bold" fontFamily="sans-serif">
          Z
        </text>
        <text x="56" y="14" fontSize="8" fontWeight="bold" fontFamily="sans-serif">
          z
        </text>
        <text x="62" y="9" fontSize="6.5" fontWeight="bold" fontFamily="sans-serif">
          z
        </text>
      </g>
      {/* Curled Body */}
      <path
        d="M34 52C22 52 12 43 12 33C12 25 17 19 25 16C36 12 48 18 50 28C52 38 45 52 34 52Z"
        fill="url(#foxSleepGrad)"
      />
      {/* Tail Wrapped Around */}
      <path
        d="M14 42C10 36 8 28 12 23C15 27 20 35 28 38C36 41 44 39 48 35C45 44 38 52 28 52C20 52 16 48 14 42Z"
        fill="#E07A5F"
      />
      <path d="M11 25C9 28 10 32 12 35C13 32 15 29 18 27C15 25 13 24 11 25Z" fill="#F5EBE1" />
      {/* Resting Head */}
      <circle cx="36" cy="32" r="11" fill="url(#foxSleepGrad)" />
      {/* Ears Folded Back */}
      <polygon points="32,24 26,17 37,21" fill="#E07A5F" />
      <polygon points="32,23 28,19 35,21" fill="#26201B" />
      <polygon points="42,24 48,17 41,22" fill="#E07A5F" />
      {/* Cream Muzzle */}
      <path
        d="M29 34C31 37 34 38 36 38C38 38 41 37 43 34C40 35.5 38 35 36 35C34 35 32 35.5 29 34Z"
        fill="#F5EBE1"
      />
      {/* Peaceful Closed Sleeping Eye Curves */}
      <path d="M31 32C32.5 33.5 34 33.5 35 32" stroke="#1C1714" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M37 32C38.5 33.5 40 33.5 41 32" stroke="#1C1714" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="36" cy="35" rx="1.5" ry="1" fill="#1C1714" />
    </svg>
  );
}
