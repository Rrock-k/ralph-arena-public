/**
 * Hand-drawn naive SVG doodles in a childlike style.
 * Deliberately wobbly paths, uneven proportions, crayon-like strokes.
 */

const STROKE = "#222";
const STROKE_W = 2.2;

/** A stick-figure robot with antenna, square head, circle eyes */
export function DoodleRobot({ size = 100 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: "inline-block" }}>
      {/* antenna */}
      <path d="M50 8 Q48 18 50 22" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" />
      <circle cx="50" cy="6" r="3.5" fill="#ff6b6b" stroke={STROKE} strokeWidth={1.5} />
      {/* head */}
      <path d="M30 22 Q29 21 70 22 Q72 23 71 45 Q70 47 30 46 Q28 44 30 22Z" stroke={STROKE} strokeWidth={STROKE_W} fill="#fffbe6" />
      {/* eyes — uneven circles */}
      <circle cx="40" cy="32" r="4.5" fill={STROKE} />
      <circle cx="60" cy="33" r="5" fill={STROKE} />
      {/* mouth — wobbly line */}
      <path d="M38 40 Q44 44 50 40 Q56 36 62 40" stroke={STROKE} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      {/* body */}
      <path d="M35 46 Q34 47 33 72 Q34 74 67 73 Q68 72 66 46" stroke={STROKE} strokeWidth={STROKE_W} fill="#d0ebff" />
      {/* belly button / panel */}
      <rect x="44" y="54" width="13" height="10" rx="1" stroke={STROKE} strokeWidth={1.5} fill="#a5d8ff" />
      {/* arms — wobbly sticks */}
      <path d="M33 52 Q25 50 18 56 Q14 60 16 64" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" />
      <path d="M67 53 Q75 50 82 55 Q86 59 84 63" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" />
      {/* fingers — little lines */}
      <path d="M16 64 L12 62 M16 64 L13 67 M16 64 L17 68" stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M84 63 L88 61 M84 63 L87 66 M84 63 L83 67" stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" />
      {/* legs */}
      <path d="M42 73 Q41 80 39 90 Q38 94 33 95" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" />
      <path d="M58 73 Q59 81 61 90 Q62 94 67 95" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" />
      {/* feet — little rectangles */}
      <path d="M25 94 Q26 91 33 95 Q34 97 26 97Z" stroke={STROKE} strokeWidth={1.5} fill={STROKE} />
      <path d="M75 94 Q74 91 67 95 Q66 97 74 97Z" stroke={STROKE} strokeWidth={1.5} fill={STROKE} />
    </svg>
  );
}

/** Wobbly arrow pointing right */
export function DoodleArrow({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 60 30" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M4 16 Q15 14 25 16 Q35 18 45 15" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" />
      <path d="M40 8 Q44 12 48 15 Q44 19 40 23" stroke={STROKE} strokeWidth={STROKE_W} strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Hand-drawn star / sparkle */
export function DoodleStar({ size = 24, color = "#ffd43b" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path
        d="M15 2 Q16 10 14 12 Q10 11 2 13 Q10 15 13 17 Q12 22 14 28 Q16 22 18 17 Q22 16 28 15 Q22 13 18 12 Q17 8 15 2Z"
        fill={color}
        stroke={STROKE}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Thumbs up hand — naive style */
export function DoodleThumbsUp({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      {/* thumb */}
      <path d="M20 6 Q18 4 16 8 Q14 14 15 18 Q13 18 10 19 Q7 20 7 24 Q7 28 8 31 Q9 34 14 35 Q18 36 22 35 Q26 34 28 32 Q30 30 30 26 Q30 22 28 19 Q26 18 22 18 Q22 14 21 10 Q20 7 20 6Z"
        fill="#ffe8cc"
        stroke={STROKE}
        strokeWidth={STROKE_W}
        strokeLinejoin="round"
      />
      {/* thumb nail */}
      <path d="M18 8 Q19 10 19 13" stroke={STROKE} strokeWidth={1.2} strokeLinecap="round" />
      {/* finger lines */}
      <path d="M11 23 Q17 23 24 23" stroke={STROKE} strokeWidth={1} strokeLinecap="round" />
      <path d="M11 27 Q16 27 23 27" stroke={STROKE} strokeWidth={1} strokeLinecap="round" />
      <path d="M12 31 Q17 31 22 31" stroke={STROKE} strokeWidth={1} strokeLinecap="round" />
    </svg>
  );
}

/** Wobbly heart */
export function DoodleHeart({ size = 24, color = "#ff6b6b" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path
        d="M15 27 Q8 20 4 16 Q0 11 3 7 Q6 3 10 5 Q13 7 15 11 Q17 7 20 5 Q24 3 27 7 Q30 11 26 16 Q22 20 15 27Z"
        fill={color}
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lightning bolt */
export function DoodleBolt({ size = 28, color = "#ffd43b" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 36" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path
        d="M18 2 L7 17 L14 17 L11 34 L24 16 L17 16 L18 2Z"
        fill={color}
        stroke={STROKE}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Eye — watching you */
export function DoodleEye({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 40 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M2 12 Q10 2 20 3 Q30 2 38 12 Q30 22 20 21 Q10 22 2 12Z" fill="#fff" stroke={STROKE} strokeWidth={STROKE_W} />
      <circle cx="20" cy="12" r="6" fill="#4263eb" stroke={STROKE} strokeWidth={1.5} />
      <circle cx="20" cy="12" r="2.5" fill={STROKE} />
      <circle cx="22" cy="10" r="1.2" fill="#fff" />
    </svg>
  );
}

/** Squiggly underline decoration */
export function DoodleSquiggle({ width = 120, color = "#ff6b6b" }: { width?: number; color?: string }) {
  return (
    <svg width={width} height="8" viewBox="0 0 120 8" fill="none" style={{ display: "block", margin: "0 auto" }}>
      <path
        d="M2 5 Q10 1 20 5 Q30 9 40 5 Q50 1 60 5 Q70 9 80 5 Q90 1 100 5 Q110 9 118 5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
