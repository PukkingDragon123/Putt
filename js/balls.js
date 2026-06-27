// Golf balls sold by the basement shopkeeper. Each ball's `mods` multiply the
// base physics constants (friction, max power, sink radius, aim-guide length)
// and `smash` is the world-speed (u/s) above which a hit knocks LIGHT clutter
// aside instead of just nudging it. The "range" ball is the free starter.
const BASE = { sinkR: 1, frict: 1, powerMax: 1, aimGuide: 1, smash: 0 };

export const BALLS = {
  range:  { key: "range",  name: "Gutter Ball", price: 0,  glyph: "⚪",
            blurb: "Cracked range ball. It rolls. Mostly.",
            color: [0.86, 0.84, 0.78], emissive: 0.05, mods: { ...BASE } },
  slick:  { key: "slick",  name: "Slick",       price: 18, glyph: "🟡",
            blurb: "Waxed smooth — runs far on the felt.",
            color: [0.9, 0.86, 0.45], emissive: 0.06, mods: { ...BASE, frict: 0.72, aimGuide: 1.15 } },
  cannon: { key: "cannon", name: "Cannon",      price: 26, glyph: "🟠",
            blurb: "Heavy core, huge power. Smashes junk.",
            color: [0.85, 0.4, 0.18], emissive: 0.08, mods: { ...BASE, powerMax: 1.35, frict: 1.05, smash: 9, sinkR: 0.95 } },
  magnet: { key: "magnet", name: "Magnet",      price: 34, glyph: "🔵",
            blurb: "Drawn to the cup — forgiving sinks.",
            color: [0.35, 0.78, 0.86], emissive: 0.12, mods: { ...BASE, sinkR: 1.55, aimGuide: 1.25, frict: 0.95 } },
  lead:   { key: "lead",   name: "Lead Shot",   price: 30, glyph: "⚫",
            blurb: "Bulldozer. Plows light clutter flat.",
            color: [0.5, 0.5, 0.56], emissive: 0.05, mods: { ...BASE, smash: 6, powerMax: 1.1, frict: 1.15, sinkR: 1.1 } },
  ghost:  { key: "ghost",  name: "Ghost Ball",  price: 48, glyph: "👻",
            blurb: "The good stuff. Better at everything.",
            color: [0.82, 0.92, 1.0], emissive: 0.2, mods: { ...BASE, sinkR: 1.3, frict: 0.78, powerMax: 1.2, aimGuide: 1.3, smash: 7 } },
};

export const BALL_KEYS = Object.keys(BALLS);
export const SHOP_POOL = BALL_KEYS.filter(k => k !== "range"); // the buyable upgrades
