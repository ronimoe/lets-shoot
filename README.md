# Breachpoint

A tactical 5v5 bomb-defusal shooter that runs entirely in the browser (Three.js + TypeScript + Vite). You play as the
**Vanguard** (attack: plant the charge at site A or B) or the **Sentinel** (defend: stop the plant or defuse it) on an
original three-lane map, *Foundry*, against bots that buy, stage, execute, throw grenades, rotate and retake.

Everything is original: map, factions, weapons, textures (procedural canvas) and audio (synthesized WebAudio, HRTF-spatialized). No external assets are downloaded.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ on http://localhost:4173
```

## Deploy to Vercel

The project is a static Vite app; `vercel.json` already sets the build command and `dist` output.

```bash
npx vercel          # preview deployment
npx vercel --prod   # production
```

Or import the Git repository in the Vercel dashboard; it detects the settings automatically.

> Online multiplayer is not included: Vercel serves static files and short-lived functions and cannot host the
> long-running game server that real-time multiplayer needs. The game is single-player against bots.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move · Shift walk (silent) · C crouch · Space jump (crouch mid-air to reach crates) |
| Mouse | Aim · LMB fire · RMB scope (Longbow) |
| 1 / 2 / 3 / 4 / 5, wheel, Q | Primary · pistol · blade · grenades · charge · last weapon |
| R | Reload |
| E | Hold to plant (in a site) / defuse; tap near a dropped gun to swap |
| B | Buy menu (in your spawn during buy time) |
| G | Drop the charge |
| Tab | Scoreboard · Esc pause / settings |

## Rules

- First to 7 rounds; sides swap after round 6 (economy resets). A 6–6 tie goes to a 13th round.
- 6 s buy phase, 1:55 rounds, 3 s plant, 40 s fuse, 7 s defuse (3.5 s with a kit).
- Economy: $800 start, $3250 per round win ($3500 for an objective win), escalating loss bonus ($1400 → $2900), $800 plant bonus for the losing attackers, per-weapon kill rewards, $16 000 cap.
- Movement accuracy matters: running spreads shots, stopping/crouching tightens them; automatic weapons follow a fixed, learnable recoil pattern that recovers when you stop firing.
- Bullets penetrate crates (with damage loss) but not walls. Head ×4, legs ×0.75; armor and helmets reduce damage.

## Acceptance checklist

Verified on this build (dev and production preview):

- [x] `npm run build` passes (`tsc --noEmit` clean) and the production preview runs with no console errors
- [x] Full matches play start to finish: buy phase → live → plant → defuse / detonation → round end → halftime swap → match over
- [x] Player movement, jump, crouch, firing, reload, weapon switching, buying, planting, defusing and grenades work through the real keyboard/mouse input path
- [x] Hit detection with head/body/leg hitboxes, armor, crate penetration, kill feed, kill rewards
- [x] Bots buy by economy (eco/force/full buy), stage and execute on a site, smoke entrances, frag last-known positions, plant, guard the plant, hold angles, rotate, group up for retakes, defuse, and pick up dropped rifles
- [x] Bot-vs-bot balance at Regular skill is near even: 46 % attack wins over 195 simulated rounds (individual matches swing 35–60 % because the economy snowballs)
- [x] Holds 60 fps (display cap) during a live 5v5 round in the dev build; simulation + render submit ≈0.5 ms CPU per frame

Not verified here: real pointer lock (the test browser pane refuses it — the game falls back to a "Click to aim" prompt) and GPU frame time on low-end hardware.

## Testing hooks

`window.__game` exposes test helpers in the browser console:

- `__game.sim(n, difficulty)` — plays `n` bot-only matches headlessly and returns win/plant/defuse stats
- `__game.start({ side, difficulty, spectator, teamSize })`, `__game.state()`, `__game.step(ticks)`
- `__game.pump(frames)`, `__game.key(code, down)`, `__game.mouse(button, down)` — drive the real frame loop and input
- `?autotest` URL parameter starts a spectator bot match

## Code map

| File | Purpose |
| --- | --- |
| `src/map.ts` | Grid map: geometry heights, zones, raycasts, A* pathfinding |
| `src/world.ts` | Builds map meshes (face-culled, world-UV) and lighting |
| `src/game.ts` | Simulation: movement physics, weapons, hitscan, grenades, charge, rounds, economy |
| `src/bot.ts` | Bot AI: buying, perception, aiming, tactics |
| `src/weapons.ts` | Weapon and gear definitions, recoil pattern |
| `src/hud.ts` | HUD, radar, scoreboard, buy menu |
| `src/main.ts` | Renderer, input, viewmodel, menus, main loop |
| `src/audio.ts` | Synthesized, spatialized sound |
