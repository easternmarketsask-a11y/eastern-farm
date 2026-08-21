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
assert.match(iso, /_followDriveCam/);
assert.match(iso, /mot\.bob|motion\.bob/);
assert.match(iso, /headlight|headlamp|_carLights/);
assert.ok(!/ctx\.rotate\(0\.05\)/.test(farmer), '人走路不得再歪');

assert.match(audio, /startEngine/);
assert.match(audio, /stopEngine/);
assert.ok(/startEngine[\s\S]{0,800}lowpass|startEngine[\s\S]{0,800}_noise/.test(audio),
  '引擎必须是低通噪声，不能是蜂鸣');

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
