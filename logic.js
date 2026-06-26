// Solo game: all rules run client-side in index.html. The apps-engine still
// requires a code module at the zip root, so this is the documented solo stub
// (build-game.md §1) — a pure, import-free, timer-free rules module.
export const meta = { game: "putt-or-die", minPlayers: 1, maxPlayers: 1 };
export function setup() { return {}; }
export function validateAction() { return { ok: true }; }
export function applyAction(state) { return state; }
export function isGameOver() { return { over: false }; }
export function viewFor(state) { return state; }
