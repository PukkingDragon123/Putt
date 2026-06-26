// The Buckshot-style item kit. Each item's `apply(g)` mutates game state and
// returns a toast string (or null if it could not be used). `g` is the Game.
import { STR } from "../strings.js";

export const ITEMS = {
  beer: {
    key: "beer", ...STR.items.beer,
    apply(g) {
      // Rack the gun: eject the next undrawn shell unfired.
      if (g.shellIndex < g.chamber.length) {
        g.chamber.splice(g.shellIndex, 1);
        g.audio.item();
        return STR.ejected;
      }
      return null;
    },
  },
  pills: {
    key: "pills", ...STR.items.pills,
    apply(g) {
      if (g.rand() < 0.5) { g.heal(2); g.audio.pill(true); return STR.pillsGood; }
      g.damage(1, "pills"); g.wobble = true; g.audio.pill(false); return STR.pillsBad;
    },
  },
  smoke: {
    key: "smoke", ...STR.items.smoke,
    apply(g) { if (g.hp >= g.maxHp) return null; g.heal(1); g.audio.heal(); return STR.healed; },
  },
  glass: {
    key: "glass", ...STR.items.glass,
    apply(g) {
      if (g.shellIndex < g.chamber.length) {
        g.chamber[g.shellIndex].revealed = true;
        g.audio.click();
        const t = g.chamber[g.shellIndex].type === "live" ? STR.shellLive : STR.shellBlank;
        return STR.glass.replace("%s", t);
      }
      return null;
    },
  },
  saw: {
    key: "saw", ...STR.items.saw,
    apply(g) { g.powerShot = true; g.audio.item(); return STR.saw; },
  },
  cuffs: {
    key: "cuffs", ...STR.items.cuffs,
    apply(g) { g.cuffed = true; g.audio.item(); return STR.cuffed; },
  },
};

export const ITEM_KEYS = Object.keys(ITEMS);
