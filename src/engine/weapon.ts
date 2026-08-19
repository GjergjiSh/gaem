// The arsenal. Three guns in slots 1-3. The rifle and the shotgun fire real
// PROJECTILES with drop, so you lead your shots; the railgun is HITSCAN and lands
// the instant you click. That split is the point — two weapons ask you to read
// the fight, one asks you to already be right.
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

interface GunStats {
  cycle: number;      // seconds between shots
  pellets: number;
  spread: number;     // cone half-angle, radians
  damage: number;     // per shot/pellet, x the shared head/body damage
  pierce: number;     // targets a shot passes through before it stops
  /** Instant ray instead of a projectile. The ballistics below go unread. */
  hitscan: boolean;
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
      cycle: T.rifle.boltTime,
      pellets: 1,
      spread: T.rifle.spread,
      damage: T.rifle.damage,
      pierce: 0,
      hitscan: false,
      beamTime: 0,
      projSpeed: T.rifle.projSpeed,
      projDrop: T.rifle.projDrop,
      projSize: T.rifle.projSize,
    }),
  },
  {
    name: 'shotgun',
    stats: () => ({
      cycle: T.shotgun.pumpTime,
      pellets: Math.max(1, Math.round(T.shotgun.pellets)),
      spread: T.shotgun.spread,
      damage: T.shotgun.damage,
      pierce: 0,
      hitscan: false,
      beamTime: 0,
      projSpeed: T.shotgun.projSpeed,
      projDrop: T.shotgun.projDrop,
      projSize: T.shotgun.projSize,
    }),
  },
  {
    name: 'railgun',
    stats: () => ({
      cycle: T.railgun.chargeTime,
      pellets: 1,
      spread: T.railgun.spread,
      damage: T.railgun.damage,
      pierce: Math.max(0, Math.round(T.railgun.pierce)),
      hitscan: true,
      beamTime: T.railgun.beamTime,
      projSpeed: 0,
      projDrop: 0,
      projSize: 0,
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

    if (this.input.weaponSlot !== null) {
      const want = this.input.weaponSlot;
      this.input.weaponSlot = null;
      this.select(want);
    }
    if (this.input.weaponSwap) {
      this.input.weaponSwap = false;
      this.select(this.lastSlot);
    }

    if (this.input.shootPressed) {
      this.input.shootPressed = false;
      if (this.ready) this.fire();
    }

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
    this.styleKey = '';   // the new gun's spread changes the reticle bloom
  }

  private fire() {
    const g = this.gun.stats();
    this.cycle = g.cycle;

    const cam = this.gfx.camera;
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const origin = cam.position.clone().add(fwd.clone().multiplyScalar(0.6));

    // Basis for the cone. Any two vectors perpendicular to the aim will do; the
    // camera's own up keeps the pattern stable relative to the view.
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

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
      if (g.hitscan) {
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
    const state = this.raise > 0 ? 'raise' : this.cycle > 0 ? 'cycle' : 'READY';
    const rack = GUNS.map((g, i) => `${i + 1}:${g.name}${i === this.slot ? '*' : ''}`).join(' ');
    return `${this.gun.name.padEnd(8)}${state}   ${rack}  [Q last]`
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
