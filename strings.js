// All player-visible strings. Switching language is a data change (§10.3).
export const STR = {
  title: "PUTT OR DIE",
  tagline: "Sink it. Get paid. Go deeper. Don't go broke.",
  start: "ENTER THE BASEMENT",
  hint: "AIM:  A / D  ·  ←  →  ·  drag      PUTT:  SPACE  /  tap (tap again to fire)",

  hud: { floor: "FLOOR", par: "PAR", stroke: "STROKE", ball: "BALL" },
  depth: "DEPTH", cash: "CASH", best: "BEST",

  score: {
    ace: "HOLE IN ONE!", eagle: "EAGLE", birdie: "BIRDIE", par: "PAR",
    bogey: "BOGEY", double: "DOUBLE BOGEY", lost: "LOST BALL",
  },
  splash: "SPLASH — water. +1 stroke.",
  lostBall: "Couldn't sink it...",

  // Shop — a homeless man living down here, selling balls out of a sack
  shopTitle: "THE BASEMENT MAN",
  shopBarks: [
    "\"Psst. Good balls. Cheap. Mostly clean.\"",
    "\"Found these in the walls. They roll true.\"",
    "\"You got cash, I got the good stuff.\"",
    "\"Buy somethin' or keep movin', friend.\"",
    "\"This one's lucky. Trust me. I live here.\"",
    "\"The deeper you go, the more you'll want it.\"",
  ],
  owned: "OWNED",
  descend: "DESCEND  −$%n",

  over: "BANKRUPT",
  again: "BACK TO THE TABLE",

  // Dealer barks shown when a hole loads
  dealer: [
    "\"Tee off, meat.\"",
    "\"Par pays. Bogey bleeds.\"",
    "\"The house always collects.\"",
    "\"Down we go.\"",
    "\"Mind the rats.\"",
    "\"Sink it or sink, friend.\"",
    "\"Every floor costs more.\"",
    "\"Cheap clubs, expensive mistakes.\"",
    "\"Watch the slope.\"",
    "\"Lower. Always lower.\"",
  ],
};
