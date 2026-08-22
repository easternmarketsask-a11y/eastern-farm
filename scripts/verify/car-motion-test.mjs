/**
 * 开车动画契约。车不能再是贴图在格子上滑：
 * 悬挂弹跳、扬尘、起步蹲下/刹车点头、引擎声、镜头轻跟。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const farmer = readFileSync(join(root, 'src/js/farmer.js'), 'utf8');
const iso = readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8');
const audio = readFileSync(join(root, 'src/js/audio.js'), 'utf8');

assert.match(farmer, /function driveFx\(/);
assert.match(farmer, /driveFx:\s*driveFx/);
assert.match(farmer, /driveAccel|driveBrake/);
assert.match(farmer, /driveDust/);
assert.match(farmer, /driveTurnT/);
assert.ok(/moveSpeed[\s\S]{0,500}driveAccel/.test(farmer) || /driveAccel[\s\S]{0,400}moveSpeed/.test(farmer),
  '车速必须吃起步加速');
assert.ok(/remainingPath|driveBrake/.test(farmer), '到站前要减速');

assert.match(iso, /_blitCar\(/);
assert.match(iso, /_drawCarDust|_carDust/);
/* 2026-08-22：`_followDriveCam` 改名 `_followActorCam`（开车照旧居中跟，
   走路改成「快出画才推镜头」的死区跟随）。这里钉两件事：
   ① 开车仍然跟；② 走路那条死区分支还在 —— 否则可走范围放开之后，
   人走出视野镜头不动，玩家会把自己的农民走丢。 */
assert.match(iso, /_followActorCam/);
assert.ok(!/_followDriveCam/.test(iso), '旧名不该再出现（改名要改干净）');
assert.match(iso, /_followActorCam\(\)[\s\S]{0,1400}?A\.path[\s\S]{0,500}?W \* 0\.30[\s\S]{0,200}?H \* 0\.28/,
  '走路要有死区跟随(W*0.30 / H*0.28)，不是每步都把人居中');
assert.match(iso, /mot\.bob|motion\.bob/);
assert.match(iso, /headlight|headlamp|_carLights/);
assert.ok(!/ctx\.rotate\(0\.05\)/.test(farmer), '人走路不得再歪');

assert.match(audio, /startEngine/);
assert.match(audio, /stopEngine/);
/* 2026-08-21 改严：原来只要求「startEngine 后 800 字符内有 lowpass 或 _noise」，
   窗口匹配，实现一变长就落窗外。现在直接钉住真正的意图 ——
   内燃机的声音是一串点火脉冲，加速是脉冲变密（playbackRate），
   不是把一个嗡嗡声的音调往上平移。 */
assert.match(audio, /_makeEngineCycle\(/);
assert.ok(/_makeEngineCycle[\s\S]{0,2000}playbackRate/.test(audio),
  '引擎变速必须靠脉冲循环的 playbackRate，不能是音调平移');
assert.ok(/startEngine[\s\S]{0,2000}lowpass/.test(audio),
  '引擎要低通：车外听到的没有机械毛刺');
assert.ok(!/startEngine[\s\S]{0,600}osc\.frequency\.value = \d+;[\s\S]{0,200}oscGain/.test(audio),
  '引擎不能退回「一个振荡器嗡嗡响」');

assert.match(farmer, /boardHop/);
assert.match(farmer, /alightHop/);
assert.match(farmer, /hopLift/);
assert.ok(/driving != null && !\(A\.boardHop > 0\)/.test(farmer)
  || /boardHop > 0/.test(farmer) && /driving != null/.test(farmer),
  '上车跳跃那一帧还要画人，不能瞬间消失');

assert.match(iso, /_syncPetRides/);
assert.match(iso, /_drawCarRiders/);
assert.match(iso, /RIDE_PETS/);
assert.match(iso, /p\.ride/);
assert.match(iso, /if \(p\.ride\) return/);
assert.ok(!/ride[\s\S]{0,40}Farm\.state\.save/.test(iso), '宠物上车不得落盘');

console.log('ok car-motion');
