/**
 * The pet's own life in the room (P7: out of RoomScene): its face and breath, the habit it shows while it rests, the
 * hop when tapped, the food that arcs in and is eaten bite by bite, the ball it plays with, what the living room brings
 * (a toy, a friend, a noise), the light bulb of a taught lesson, the thought of food when it is hungry, Zzz while it
 * sleeps, a note when it is happy, and the dust that gathers when it has not been cleaned.
 */
import { type Container, Sprite } from "pixi.js";
import type { Expression } from "@lingxi/art";
import { PET_FEET, PET_HOME } from "./floor";
import { habitPose } from "./habitPose";
import type { Particles } from "./particles";
import { bgTexture } from "./roomArt";
import type { SceneProps } from "./RoomScene";
import { BITS, petTexture } from "./textures";

/** How tall each stage stands, to put things above its head. */
const HEAD = { baby: 15, child: 22, teen: 28, adult: 34 } as const;

function expressionFor(p: SceneProps, now: number, blinking: boolean): { e: Expression; lit: boolean } {
  const care = p.lastCare && now - p.lastCare.at < 2600 ? p.lastCare.kind : null;
  if (p.asleep) return { e: "asleep", lit: false };
  if (p.sick && !care) return { e: "dizzy", lit: false };
  if (care === "feed") return { e: Math.floor(now / 220) % 2 ? "munch" : "munchShut", lit: true };
  if (care === "pet") return { e: "love", lit: true };
  if (care === "clean") return { e: p.lastCare && now - p.lastCare.at < 900 ? "sneeze" : "happy", lit: true };
  if (care === "play") return { e: "happy", lit: true };
  if (blinking) return { e: "asleep", lit: false };
  if (p.want === 5) return { e: "sulk", lit: false };
  if (p.want === 3) return { e: "sleepy", lit: false };
  if (p.want === 1) return { e: "sad", lit: false };
  if (p.want === 6) return { e: "shy", lit: true };
  if (p.mood === 3) return { e: "sparkly", lit: true };
  if (p.mood === 2) return { e: "happy", lit: false };
  if (p.mood === 0) return { e: "sulk", lit: false };
  return { e: "neutral", lit: false };
}

export interface PetLife {
  /** one frame, with the pet standing at `PET_X` and the pointer at `lookX` */
  update: (now: number, p: SceneProps, PET_X: number, lookX: number) => void;
}

export function createPetLife(ctx: {
  pet: Sprite;
  /** the layer under the cat and the pet, where dust gathers */
  floor: Container;
  /** the layer in front of the pet: food, ball, thought, what the living room brings */
  props: Container;
  particles: Particles;
  latest: () => SceneProps;
}): PetLife {
  const { pet, floor, props, particles } = ctx;
  // where the pet stands, as of the last frame (a tap between frames bursts from there)
  let PET_X = PET_HOME;
  const bunnies = [new Sprite(BITS.bunny(false)), new Sprite(BITS.bunny(false))];
  bunnies.forEach((b, i) => {
    b.anchor.set(0.5, 1);
    b.x = i ? 42 : 88;
    b.visible = false;
    floor.addChild(b);
  });
  const ball = new Sprite(BITS.ball());
  ball.anchor.set(0.5);
  ball.visible = false;
  const food = new Sprite();
  food.anchor.set(0.5);
  food.visible = false;
  let foodScale = 0.4;
  const thought = new Sprite(BITS.bubble());
  thought.anchor.set(0.5, 1);
  thought.visible = false;
  const thoughtFood = new Sprite();
  thoughtFood.anchor.set(0.5);
  thoughtFood.visible = false;
  // G1: what the living room brings (a toy, a friend, a noise) and the light bulb of a taught lesson
  const visitorToy = new Sprite(BITS.ball());
  visitorToy.anchor.set(0.5, 1);
  visitorToy.visible = false;
  const visitorFriend = new Sprite(BITS.friend(false));
  visitorFriend.anchor.set(0.5, 1);
  visitorFriend.visible = false;
  const alarm = new Sprite(BITS.alarm());
  alarm.anchor.set(0.5, 1);
  alarm.visible = false;
  const bulb = new Sprite(BITS.bulb());
  bulb.anchor.set(0.5, 1);
  bulb.visible = false;
  props.addChild(ball, food, thought, thoughtFood, visitorToy, visitorFriend, alarm, bulb);
  void bgTexture("/art/items/rice_mochi.png").then((t) => {
    if (thoughtFood.destroyed) return;
    thoughtFood.texture = t;
    thoughtFood.scale.set(10 / Math.max(t.width, t.height));
  });
  let feedAt = -1;
  let playAt = -1;
  // a feed or play that happened while a sheet covered the room plays when it is seen
  let feedWaiting = -1;
  let playWaiting = -1;
  let lastZ = 0;
  let hopAt = -1;
  pet.on("pointertap", (e) => {
    if (ctx.latest().decorating) return;
    e.stopPropagation();
    ctx.latest().onPetTap();
    if (!ctx.latest().asleep && !ctx.latest().reduceMotion) hopAt = performance.now();
    if (!ctx.latest().asleep) particles.burst("heart", 5, ["#FF7A9A", "#FFC83D"], PET_X);
  });

  let lastCareAt = -1;
  let blinkAt = performance.now() + 1500;
  const update: PetLife["update"] = (now, p, petX, lookX) => {
    PET_X = petX;
    // a poorly pet gives off a little green swirl now and then
    if (p.sick && !p.asleep && !p.reduceMotion && Math.random() < 0.012)
      particles.burst("spark", 1, ["#7BD389", "#5FB46F"], PET_X);
    if (p.lastCare && p.lastCare.at !== lastCareAt) {
      lastCareAt = p.lastCare.at;
      if (p.lastCare.kind === "feed") {
        particles.burst("heart", 3, ["#FF7A9A"], PET_X);
        // the food arcs in from the side, then gets eaten bite by bite
        const art = p.lastCare.food;
        if (art && !p.reduceMotion) {
          feedWaiting = now;
          food.visible = false;
          void bgTexture(art.startsWith("/") ? art : `/${art}`).then((t) => {
            if (food.destroyed) return;
            food.texture = t;
            foodScale = { baby: 8, child: 10, teen: 12, adult: 13 }[ctx.latest().stage] / Math.max(t.width, t.height);
            food.scale.set(foodScale);
          });
        }
      }
      if (p.lastCare.kind === "clean") particles.burst("spark", 8, ["#FFFFFF", "#FFC83D"], PET_X);
      if (p.lastCare.kind === "play") {
        particles.burst("note", 3, ["#2F7FD6"], PET_X);
        if (!p.reduceMotion) playWaiting = now;
      }
    }
    if (now > blinkAt) blinkAt = now + 2400 + Math.random() * 2400;
    const blinking = now > blinkAt - 140;
    const face = expressionFor(p, now, blinking);
    let e = face.e;
    const lit = face.lit;
    let squash: -1 | 0 | 1 = 0;
    let lift = 0;
    // D6: a small habit while its circuit chooses to rest (habitPose: timed by the clock, never at random)
    const resting =
      !p.asleep && !p.sick && p.want === 0 && !(p.lastCare && now - p.lastCare.at < 2600) && !p.reduceMotion;
    const pose = habitPose(p.habit, now, resting);
    const habitShift = pose?.shift ?? 0;
    if (pose) {
      if (pose.expression) e = pose.expression;
      if (pose.squash) squash = 1;
      if (pose.face) pet.scale.x = pose.face;
      if (pose.hop && hopAt < 0) hopAt = now;
    }
    if (hopAt >= 0) {
      const k = (now - hopAt) / 520;
      if (k > 1) hopAt = -1;
      else if (k < 0.16 || k > 0.84) squash = -1;
      else {
        squash = 1;
        lift = Math.round(Math.sin(((k - 0.16) / 0.68) * Math.PI) * 7);
      }
    }
    const breath: 0 | 1 = p.reduceMotion ? 0 : Math.sin(now / (p.asleep ? 900 : 620)) > 0.35 ? 1 : 0;
    pet.texture = petTexture(p.line, {
      stage: p.stage,
      expression: e,
      breath,
      squash,
      lit,
      ...(p.form ? { form: p.form } : {}),
      ...(p.outfit ? { outfit: p.outfit } : {}),
    });
    pet.x = PET_X + habitShift;
    pet.y = PET_FEET - lift;
    pet.visible = !p.absent;
    if (!p.covered) {
      if (feedWaiting >= 0) {
        if (now - feedWaiting < 30_000) feedAt = now;
        feedWaiting = -1;
      }
      if (playWaiting >= 0) {
        if (now - playWaiting < 30_000) {
          playAt = now;
          hopAt = now;
        }
        playWaiting = -1;
      }
    }
    const busyCare = (p.lastCare !== null && now - p.lastCare.at < 2600) || feedAt >= 0 || playAt >= 0;
    const head = PET_FEET - HEAD[p.stage];

    // play: a ball bounces back and forth and the pet keeps its eyes on it
    if (playAt >= 0) {
      const k = (now - playAt) / 2600;
      if (k > 1) {
        playAt = -1;
        ball.visible = false;
      } else {
        const bx = PET_X + Math.sin(k * Math.PI * 3) * 26;
        const bh = Math.abs(Math.sin(k * Math.PI * 7)) * 16 * (1 - k * 0.5);
        ball.visible = true;
        ball.x = Math.round(bx);
        ball.y = Math.round(PET_FEET - 3 - bh);
        pet.scale.x = bx < PET_X ? -1 : 1;
        if (hopAt < 0 && Math.random() < 0.03) hopAt = now;
      }
    } else if (!p.asleep && !busyCare && Math.abs(lookX - PET_X) > 8 && !pose?.face) {
      // otherwise it turns toward your pointer
      pet.scale.x = lookX < PET_X ? -1 : 1;
    }

    // feed: the food arcs into its mouth, then shrinks bite by bite with crumbs
    if (feedAt >= 0) {
      const k = (now - feedAt) / 1400;
      if (k > 1) {
        feedAt = -1;
        food.visible = false;
      } else if (food.texture && food.texture.width > 1) {
        const mx = PET_X + pet.scale.x * 3;
        const my = PET_FEET - Math.round(HEAD[p.stage] * 0.42);
        food.visible = true;
        if (k < 0.4) {
          const t = k / 0.4;
          food.x = Math.round(mx + 30 * (1 - t));
          food.y = Math.round(my - 34 * (1 - t) * (1 - t) - 8 * Math.sin(t * Math.PI));
          food.alpha = 1;
          food.scale.set(foodScale);
        } else {
          const bite = (k - 0.4) / 0.6;
          food.x = mx;
          food.y = my;
          food.alpha = 1 - bite * 0.9;
          food.scale.set(foodScale * (1 - bite * 0.75));
          if (Math.random() < 0.3) {
            const c = new Sprite(BITS.crumb(Math.random() < 0.5 ? "#FFFDF8" : "#FFC83D"));
            c.x = mx + (Math.random() * 6 - 3);
            c.y = my + 2;
            particles.add({ s: c, vx: (Math.random() - 0.5) * 0.5, vy: -0.4, life: 0.8, g: 0.06 });
          }
        }
      }
    }

    // G1: the living room's event, for five seconds from the beat that brought it
    const ev = p.event ?? 0;
    const ek = p.eventAt !== undefined ? (now - p.eventAt) / 5000 : 2;
    const showing = ev !== 0 && ek >= 0 && ek < 1 && !p.covered;
    // a toy rolls in from the left and comes to rest beside the pet
    visitorToy.visible = showing && ev === 2;
    if (visitorToy.visible) {
      const roll = Math.min(1, ek * 3.5);
      visitorToy.x = Math.round(PET_X - 70 + roll * 52);
      visitorToy.y = Math.round(PET_FEET - 1 - Math.abs(Math.sin(roll * Math.PI * 3)) * 6 * (1 - roll));
    }
    // a friend wanders up from the right and stops a little way off
    visitorFriend.visible = showing && ev === 1;
    if (visitorFriend.visible) {
      const walk = Math.min(1, ek * 2.5);
      visitorFriend.texture = BITS.friend(walk < 1 && Math.floor(now / 180) % 2 === 0);
      visitorFriend.x = Math.round(PET_X + 70 - walk * 44);
      visitorFriend.y = PET_FEET - 1;
    }
    // a noise: a red "!" over its head, and a startle
    alarm.visible = showing && ev === 3 && Math.floor(now / 250) % 2 === 0;
    alarm.x = PET_X - 12;
    alarm.y = head - 4;
    if (showing && ev === 3 && ek < 0.12 && !p.reduceMotion) pet.x = PET_X + (Math.floor(now / 40) % 2 ? 1 : -1);
    // the light bulb of a taught lesson deciding
    bulb.visible = !!p.taught && !p.asleep && !p.covered;
    bulb.x = PET_X;
    bulb.y = head - 4 + (p.reduceMotion ? 0 : Math.round(Math.sin(now / 300)));

    // hungry: a little thought of food above its head
    const hungry =
      (p.want === 1 || p.food < 250) && !p.asleep && !busyCare && (p.reduceMotion || Math.floor(now / 2600) % 2 === 0);
    thought.visible = hungry;
    thoughtFood.visible = hungry && thoughtFood.texture.width > 1;
    thought.x = PET_X + 14;
    thought.y = head - 2;
    thoughtFood.x = thought.x;
    thoughtFood.y = thought.y - 8;

    // asleep: zzz drift up; very happy: a note now and then
    if (p.asleep && !p.reduceMotion && now - lastZ > 1100) {
      lastZ = now;
      const z = new Sprite(BITS.z());
      z.anchor.set(0.5);
      z.x = PET_X + 9;
      z.y = head;
      particles.add({ s: z, vx: 0.08, vy: -0.16, life: 1 });
    }
    if (p.mood === 3 && !p.asleep && !busyCare && !p.reduceMotion && Math.random() < 0.005)
      particles.burst("note", 1, ["#2F7FD6"], PET_X);

    // dust bunnies gather when it hasn't been cleaned in a while
    const [few, many] = bunnies;
    if (few) few.visible = p.clean < 300;
    if (many) many.visible = p.clean < 150;
    bunnies.forEach((b, i) => {
      b.texture = BITS.bunny(!p.reduceMotion && Math.floor(now / 2300 + i * 3) % 6 === 0);
      b.y = PET_FEET + 3 + (!p.reduceMotion && Math.sin(now / 480 + i * 2) > 0.4 ? -1 : 0);
    });
  };
  return { update };
}
