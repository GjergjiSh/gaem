// The arsenal. Six weapons in slots 1-6, and each one asks a different question.
//
//   1 rifle      a projectile with drop — lead your shots
//   2 shotgun    a cone of the same, lethal up close and useless across the map
//   3 railgun    HITSCAN: it lands the instant you click, so you must already be right
//   4 flamer     no shot at all, just a cone that is on fire while you hold it
//   5 rocket     slow and heavy, and the blast is the weapon — aim at feet
//   6 sam        both shoulders, six missiles, they weave in and stick before going off
//
// The first three are about precision at increasing cost. The last three are
// about area, at the cost of being able to pick a target at all.
//
// Q swaps back to the last gun you held, CS/Doom style, which is the switch you
// actually use in a fight; the digits are for picking.
//
// "Scoping" is deliberately NOT a scope overlay: it's a fast FOV pull plus a
// sensitivity drop, MW-canted-laser style, so quickscoping never interrupts
// movement. No ammo either — the cycle time and the swap time are the only gates.
//
// A gun is a name plus a function returning its live stats, so adding a third is
// a tuning group and one entry in GUNS. Stats are read at the moment of firing,
// which is what lets a slider move show up on the very next shot.

import * as THREE from 'three';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import type { Renderer } from './render';
import type { Input } from './input';
import type { Enemies } from './enemies';
import type { Projectiles } from './projectiles';

/**
 * How a gun puts damage into the world. Everything else about a gun is numbers;
 * this is the one thing that is a different code path, so it is a tag rather
 * than a pile of booleans that can contradict each other.
 */
type FireMode =
  | 'bullet'      // a travelling round with drop — lead your shots
  | 'hitscan'     // resolved on the frame you click
  | 'flame'       // no round at all: a cone, re-tested every tick
  | 'rocket'      // one slow round, and the blast is the weapon
  | 'missiles';   // a burst off both shoulders that wanders in and sticks

interface GunStats {
  mode: FireMode;
  cycle: number;      // seconds between shots
  /** Shots before the long reload. 1 = every shot costs `cycle`. */
  barrels: number;
  /** Seconds after the last barrel. Only read when `barrels` > 1. */
  reload: number;
  /** Held trigger keeps firing instead of one shot per click. */
  auto: boolean;
  pellets: number;
  spread: number;     // cone half-angle, radians
  damage: number;     // per shot/pellet, x the shared head/body damage
  pierce: number;     // targets a shot passes through before it stops
  beamTime: number;   // hitscan only: how long the tracer lingers
  projSpeed: number;
  projDrop: number;
  projSize: number;
}

interface Gun {
  name: string;
  stats: () => GunStats;
}

const GUNS: Gun[] = [
  {
    name: 'rifle',
    stats: () => ({
      mode: 'bullet',
      cycle: T.rifle.boltTime,
      barrels: 1,
      reload: 0,
      auto: T.rifle.auto,
      pellets: 1,
      spread: T.rifle.spread,
      damage: T.rifle.damage,
      pierce: 0,
      beamTime: 0,
      projSpeed: T.rifle.projSpeed,
      projDrop: T.rifle.projDrop,
      projSize: T.rifle.projSize,
    }),
  },
  {
    name: 'shotgun',
    stats: () => ({
      mode: 'bullet',
      // Two shells when a reload time is set, one when it is not. The gun's
      // whole character changes on that one number and nothing else moves.
      cycle: T.shotgun.pumpTime,
      barrels: T.shotgun.secondPump > 0 ? 2 : 1,
      reload: T.shotgun.secondPump,
      auto: false,
      pellets: Math.max(1, Math.round(T.shotgun.pellets)),
      spread: T.shotgun.spread,
      damage: T.shotgun.damage,
      pierce: 0,
      beamTime: 0,
      projSpeed: T.shotgun.projSpeed,
      projDrop: T.shotgun.projDrop,
      projSize: T.shotgun.projSize,
    }),
  },
  {
    name: 'railgun',
    stats: () => ({
      mode: 'hitscan',
      cycle: T.railgun.chargeTime,
      barrels: 1,
      reload: 0,
      auto: false,
      pellets: 1,
      spread: T.railgun.spread,
      damage: T.railgun.damage,
      pierce: Math.max(0, Math.round(T.railgun.pierce)),
      beamTime: T.railgun.beamTime,
      projSpeed: 0,
      projDrop: 0,
      projSize: 0,
    }),
  },
  {
    name: 'flamer',
    stats: () => ({
      mode: 'flame',
      // The "cycle" is the damage tick. Holding the trigger is the weapon, so
      // it is auto by construction rather than by choice.
      cycle: T.flamer.tick,
      barrels: 1,
      reload: 0,
      auto: true,
      pellets: 1,
      // Reported as spread so the reticle blooms to the cone: the flamethrower's
      // range is the thing you have to judge, and it should be on screen.
      spread: T.flamer.cone,
      damage: T.flamer.damage,
      pierce: 0,
      beamTime: 0,
      projSpeed: 0,
      projDrop: 0,
      projSize: 0,
    }),
  },
  {
    name: 'rocket',
    stats: () => ({
      mode: 'rocket',
      cycle: T.rocket.cycle,
      barrels: 1,
      reload: 0,
      auto: false,
      pellets: 1,
      spread: 0,
      damage: T.rocket.damage,
      pierce: 0,
      beamTime: 0,
      projSpeed: T.rocket.speed,
      projDrop: T.rocket.drop,
      projSize: T.rocket.size,
    }),
  },
  {
    name: 'sam',
    stats: () => ({
      mode: 'missiles',
      // The gap between BURSTS. The burst itself is drained by update(), and
      // has to fit inside this or you would be able to overlap two salvos.
      cycle: Math.max(
        T.sam.cycle,
        Math.max(1, Math.round(T.sam.burst)) * T.sam.burstDelay + 0.1,
      ),
      barrels: 1,
      reload: 0,
      auto: false,
      pellets: 1,
      // Reported so the reticle blooms to roughly the area a burst covers.
      spread: Math.atan2(T.sam.paint, Math.max(T.sam.converge, 1)),
      damage: T.sam.damage,
      pierce: 0,
      beamTime: 0,
      projSpeed: T.sam.speed,
      projDrop: 0,
      projSize: T.sam.size,
    }),
  },
];

export class Weapon {
  /** 0..1 smoothed scope amount — the renderer turns this into FOV. */
  adsT = 0;
  /** Index into GUNS. */
  slot = 0;
  /** The gun Q goes back to. */
  private lastSlot = 1;
  private cycle = 0;      // seconds left in the fire cycle
  /** Barrels already fired since the last reload. Only the shotgun uses it. */
  private fired = 0;
  /**
   * Missiles still to leave the tubes, and the countdown to the next one. A
   * burst outlives the trigger pull on purpose — once the salvo is away it is
   * away, and swapping weapons mid-burst should not swallow it.
   */
  private burstLeft = 0;
  private burstT = 0;
  /** Which shoulder the next missile comes off. Alternating is the whole look. */
  private shoulder = 1;
  private raise = 0;      // seconds left of the swap animation
  private root!: HTMLDivElement;
  private dot!: HTMLDivElement;
  /** Four ticks around the dot, in order: up, down, left, right. */
  private ticks: HTMLDivElement[] = [];
  private marker!: HTMLDivElement;
  private markerT = 0;
  /** Last applied reticle values, so restyling only touches the DOM on a change. */
  private styleKey = '';

  constructor(
    private input: Input,
    private gfx: Renderer,
    private enemies: Enemies,
    private projectiles: Projectiles,
  ) {
    this.buildCrosshair();
  }

  get gun() { return GUNS[this.slot]; }
  /** Neither cycling nor still being raised. */
  get ready() { return this.cycle <= 0 && this.raise <= 0; }

  update(dt: number) {
    this.adsT = V.damp(this.adsT, this.input.adsHeld ? 1 : 0, T.weapon.adsSpeed, dt);
    this.gfx.adsT = this.adsT;
    this.cycle = Math.max(0, this.cycle - dt);
    this.raise = Math.max(0, this.raise - dt);
    this.drainBurst(dt);

    if (this.input.weaponSlot !== null) {
      const want = this.input.weaponSlot;
      this.input.weaponSlot = null;
      this.select(want);
    }
    if (this.input.weaponSwap) {
      this.input.weaponSwap = false;
      this.select(this.lastSlot);
    }

    // An auto gun fires on the HELD button, not the edge: it should keep going
    // for as long as you hold it and never care where the cycle boundary fell.
    // Everything else still needs a click per shot.
    const wantsFire = this.gun.stats().auto
      ? (this.input.shootHeld || this.input.shootPressed)
      : this.input.shootPressed;
    this.input.shootPressed = false;
    if (wantsFire && this.ready) this.fire();

    // Reticle: fades + the dot shrinks while the gun cycles or comes up, snaps
    // back when ready. Colour stays whatever the player picked, so the readiness
    // tell is opacity and scale rather than a hardcoded grey.
    this.restyle();
    this.root.style.opacity = String(T.crosshair.opacity * (this.ready ? 1 : 0.5));
    this.dot.style.transform = `translate(-50%,-50%) scale(${this.ready ? 1 : 0.55})`;

    if (this.markerT > 0) {
      this.markerT -= dt;
      this.marker.style.opacity = String(Math.max(0, this.markerT / 0.18));
    }
  }

  /** Equip a slot. Switching costs weapon.switchTime and remembers where you came from. */
  select(slot: number) {
    if (slot < 0 || slot >= GUNS.length || slot === this.slot) return;
    this.lastSlot = this.slot;
    this.slot = slot;
    this.raise = T.weapon.switchTime;
    // A gun you swapped away from mid-cycle comes back ready — the switch time is
    // the cost, and stacking a half-finished bolt on top of it just feels dead.
    this.cycle = 0;
    // Both barrels back. You reload while the other gun is up — that is what the
    // switch time is paying for.
    this.fired = 0;
    this.styleKey = '';   // the new gun's spread changes the reticle bloom
  }

  /**
   * Let the queued missiles out, one every burstDelay, alternating shoulders.
   * Driven from update() rather than from fire() so the salvo keeps launching
   * while you are already moving, aiming somewhere else, or holding nothing.
   */
  private drainBurst(dt: number) {
    if (this.burstLeft <= 0) return;
    this.burstT -= dt;
    while (this.burstLeft > 0 && this.burstT <= 0) {
      this.launchMissile();
      this.burstLeft--;
      this.burstT += Math.max(T.sam.burstDelay, 1e-3);
    }
  }

  private launchMissile() {
    const cam = this.gfx.camera;
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    // Off the shoulder, not out of the middle of your face. The tubes alternate
    // so a burst visibly comes off both sides.
    this.shoulder = -this.shoulder;
    const origin = cam.position.clone()
      .addScaledVector(right, this.shoulder * T.sam.shoulder)
      .addScaledVector(up, 0.18)
      .addScaledVector(fwd, 0.3);

    // Every missile gets its OWN target point, scattered around whatever the
    // crosshair is on. That is what paints an area: send them all to one point
    // and six missiles converge into a single explosion, which is a worse
    // rocket launcher rather than a different weapon.
    const seek = this.projectiles.aimPoint(cam.position, fwd, T.sam.converge);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * T.sam.paint;
    seek.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);

    const dir = seek.clone().sub(origin).normalize();
    this.projectiles.spawn(origin, dir.multiplyScalar(T.sam.speed), 'player', -1, {
      seek,
      size: T.sam.size,
      drop: 0,
      range: T.weapon.range,
      damage: T.sam.damage,
      pierce: 0,
      color: 0xbae6fd,
      wander: T.sam.wander,
      wanderFreq: T.sam.wanderFreq,
      wanderRamp: T.sam.armTime,
      homing: T.sam.homing,
      stick: T.sam.stick,
      blastRadius: T.sam.blastRadius,
      blastDamage: T.sam.blastDamage,
    });
  }

  private fire() {
    const g = this.gun.stats();
    // Double barrel: the short pump between the two, the long break-open after
    // the last one. Fire one and walk away and the second stays loaded.
    // The counter wraps on EVERY gun, single-barrel included. Letting it run
    // free on a one-shot gun looks harmless until you turn a second barrel on
    // mid-session: `fired` is then some large number, `barrels - fired` goes
    // negative, and String.repeat throws on a negative count — every frame,
    // from inside the HUD, which reads on screen as the game freezing.
    this.fired++;
    if (this.fired >= g.barrels) {
      this.cycle = g.barrels > 1 ? g.reload : g.cycle;
      this.fired = 0;
    } else {
      this.cycle = g.cycle;
    }

    const cam = this.gfx.camera;
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const origin = cam.position.clone().add(fwd.clone().multiplyScalar(0.6));

    // Basis for the cone. Any two vectors perpendicular to the aim will do; the
    // camera's own up keeps the pattern stable relative to the view.
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    if (g.mode === 'flame') {
      this.projectiles.flame(origin, fwd, {
        range: T.flamer.range,
        cone: T.flamer.cone,
        damage: T.flamer.damage,
        puffs: Math.max(1, Math.round(T.flamer.puffs)),
        puffLife: T.flamer.puffLife,
        puffSpeed: T.flamer.puffSpeed,
        puffSize: T.flamer.puffSize,
        puffGrow: T.flamer.puffGrow,
      });
      return;
    }

    if (g.mode === 'missiles') {
      // fire() only opens the tubes. drainBurst() is what empties them.
      this.burstLeft = Math.max(1, Math.round(T.sam.burst));
      this.burstT = 0;
      return;
    }

    if (g.mode === 'rocket') {
      this.projectiles.spawn(origin, fwd.clone().multiplyScalar(g.projSpeed), 'player', -1, {
        size: g.projSize,
        drop: g.projDrop,
        range: T.weapon.range,
        damage: g.damage,
        pierce: 0,
        color: 0xffb454,
        blastRadius: T.rocket.blastRadius,
        blastDamage: T.rocket.blastDamage,
      });
      return;
    }

    for (let i = 0; i < g.pellets; i++) {
      const dir = fwd.clone();
      if (g.spread > 0) {
        // Uniform over the cone's disc: sqrt on the radius, or every pattern
        // clumps in the middle and the choke slider stops meaning anything.
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * g.spread;
        dir.addScaledVector(right, Math.cos(a) * r);
        dir.addScaledVector(up, Math.sin(a) * r);
        dir.normalize();
      }
      if (g.mode === 'hitscan') {
        this.projectiles.hitscan(origin, dir, {
          range: T.weapon.range,
          damage: g.damage,
          pierce: g.pierce,
          beamTime: g.beamTime,
        });
      } else {
        this.projectiles.spawn(
          origin.clone(),
          dir.multiplyScalar(g.projSpeed),
          'player',
          -1,
          {
            size: g.projSize,
            drop: g.projDrop,
            range: T.weapon.range,
            damage: g.damage,
            pierce: g.pierce,
          },
        );
      }
    }
  }

  /** Hitmarker feedback, called by the projectile system when a shot lands. */
  markerFor(r: { killed: boolean; headshot: boolean }) {
    this.marker.style.color = r.killed ? (r.headshot ? '#f43f5e' : '#fbbf24') : '#ffffff';
    this.markerT = 0.18;
  }

  hudLine() {
    const g = this.gun.stats();
    const state = this.burstLeft > 0 ? 'FIRING'
      : this.raise > 0 ? 'raise'
        : this.cycle > 0 ? (g.barrels > 1 && this.fired === 0 ? 'reload' : 'cycle')
          : 'READY';
    // Clamped as well as fixed at the source: a HUD string is never worth a
    // thrown exception in the render loop.
    const left = Math.max(0, Math.min(g.barrels, g.barrels - this.fired));
    const barrels = g.barrels > 1 ? '  ' + '|'.repeat(left).padEnd(g.barrels, '.') : '';
    const rack = GUNS.map((g, i) => `${i + 1}:${g.name}${i === this.slot ? '*' : ''}`).join(' ');
    return `${this.gun.name.padEnd(8)}${state}${barrels}   ${rack}  [Q last]`
      + `   targets ${this.enemies.kills}/${this.enemies.total}`;
  }

  private buildCrosshair() {
    this.root = document.createElement('div');
    this.root.id = 'crosshair';
    this.root.style.cssText = `
      position:fixed; left:50%; top:50%; z-index:15; pointer-events:none;`;
    this.dot = document.createElement('div');
    this.dot.style.cssText = `
      position:absolute; left:0; top:0; border-radius:50%;
      transform:translate(-50%,-50%); transition:transform .08s;`;
    for (let i = 0; i < 4; i++) {
      const tick = document.createElement('div');
      tick.style.cssText = 'position:absolute; left:0; top:0; transition:transform .08s;';
      this.ticks.push(tick);
    }
    this.marker = document.createElement('div');
    this.marker.textContent = '✕';
    this.marker.style.cssText = `
      position:absolute; left:0; top:0; transform:translate(-50%,-50%);
      font:bold 20px monospace; color:#fff; opacity:0;
      text-shadow:0 0 4px rgba(0,0,0,.9);`;
    this.root.append(this.dot, ...this.ticks, this.marker);
    document.body.append(this.root);
    // The editor owns the mouse — no crosshair there.
    const style = document.createElement('style');
    style.textContent = '.editing #crosshair { display:none }';
    document.head.append(style);
    this.restyle();
  }

  /**
   * Push T.crosshair into the reticle's DOM. Called every frame so a slider move
   * lands immediately, but keyed on the values so an unchanged tune costs one
   * string compare instead of a dozen style writes.
   */
  private restyle() {
    const c = T.crosshair;
    // The ticks bloom with the equipped cone, so the shotgun's spread is
    // something you can see rather than something you discover by missing.
    const bloom = this.gun.stats().spread * c.spreadScale;
    const key = [c.dotSize, c.length, c.thickness, c.gap, c.outline, c.color, bloom].join('|');
    if (key === this.styleKey) return;
    this.styleKey = key;

    const shadow = c.outline ? '0 0 2px rgba(0,0,0,.95), 0 0 4px rgba(0,0,0,.7)' : 'none';
    this.dot.style.display = c.dotSize > 0 ? '' : 'none';
    this.dot.style.width = `${c.dotSize}px`;
    this.dot.style.height = `${c.dotSize}px`;
    this.dot.style.background = c.color;
    this.dot.style.boxShadow = shadow;

    // Each tick is offset from centre by the gap plus half its own length, so
    // `gap` means "clear space around the aim point" rather than "line origin".
    const reach = c.gap + bloom + c.length / 2;
    this.ticks.forEach((el, i) => {
      const vertical = i < 2;
      const sign = i % 2 === 0 ? -1 : 1;
      el.style.display = c.length > 0 ? '' : 'none';
      el.style.width = `${vertical ? c.thickness : c.length}px`;
      el.style.height = `${vertical ? c.length : c.thickness}px`;
      el.style.background = c.color;
      el.style.boxShadow = shadow;
      const dx = vertical ? 0 : sign * reach;
      const dy = vertical ? sign * reach : 0;
      el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px)`;
    });
  }
}
