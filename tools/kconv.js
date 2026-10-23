// Converts picked Kenney CC0 models (kenney.nl) into small game bundles (.tkz, gzip): baked vertex colours, int16 positions,
// int8 normals, uint16 indices, triangles sorted into material classes (0 plain, 1 paint/glow, 2 glass).
// Models are turned so their front (+z) points along game +x. Usage: node kconv.js <assetsDir> <outDir>
const fs = require('fs'), path = require('path');
const { readGLB } = require('./glb.js');
const [ASSETS, OUT] = process.argv.slice(2);

const P = {
  car: 'kenney_car-kit/Models/GLB format', city: 'kenney_city-kit-commercial_2.1/Models/GLB format', food: 'kenney_food-kit/Models/GLB format',
  furn: 'kenney_furniture-kit/Models/GLTF format', nat: 'kenney_nature-kit/Models/GLTF format', space: 'kenney_space-kit/Models/GLTF format', race: 'kenney_racing-kit/Models/GLTF format',
};
const hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s, l]; };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = c => (c[0] * .3 + c[1] * .59 + c[2] * .11) / 255;

// nature/furniture/space kits have flat material colours in a pastel palette; give them a natural look
const NAT = { leafsGreen: '#4f9a3a', leafsDark: '#2c6438', leafsFall: '#e0812f', woodBark: '#7a5233', woodBarkDark: '#5a3a24', woodBirch: '#efe8da', woodInner: '#d8b48a', grass: '#5f9e3e', dirt: '#8a6a4a', stone: '#9a9ca4', wood: '#a0703f', woodDark: '#7a5233', colorRed: '#e5372b', colorYellow: '#ffc629', colorPurple: '#9b5cf0' };
const SPACE = { rock: '#6a7088', rockDark: '#4a5064', rockTrack: '#7a8098' }, FURN = { plant: '#3f9a4a' };
const natural = (t, over) => { const o = over || NAT; if (o[t.mat]) t.rgb = hex(o[t.mat]); };

const CAR = { cls: (t, ref) => t.node.startsWith('wheel') ? 0 : paintHue(t.rgb, ref) ? 1 : (lum(t.rgb) > .8 && hsl(t.rgb)[1] < .5 ? 2 : 0), paint: true, wheels: true };
function paintHue(rgb, ref) { if (!ref) return false; const [h, s, l] = hsl(rgb); const d = Math.min(Math.abs(h - ref[0]), 360 - Math.abs(h - ref[0])); return s > .3 && l > .2 && d < 22; }
const GLOWWIN = { cls: t => { const [h, s, l] = hsl(t.rgb); return l > .6 && h > 180 && h < 230 && s > .25 ? 1 : 0; } }; // pale blue windows light up at night

const BUNDLES = {
  cars: [
    ...['sedan', 'hatchback-sports', 'sedan-sports', 'race', 'race-future'].map(n => [P.car, n, CAR]),
    ...['truck', 'firetruck', 'police', 'cone', 'wheel-truck', 'box', 'debris-tire'].map(n => [P.car, n, {}]),
  ],
  nature: [
    ...['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_tall', 'tree_oak_fall', 'tree_detailed_fall', 'plant_bushDetailed', 'plant_bushLarge', 'plant_bush',
      'tree_pineTallA_detailed', 'tree_pineTallB_detailed', 'tree_pineRoundC', 'tree_pineDefaultA', 'tree_pineSmallB',
      'rock_largeA', 'rock_largeC', 'rock_largeE', 'rock_tallA', 'rock_tallE', 'rock_smallA', 'rock_smallC', 'stone_largeB', 'stone_tallB', 'stone_tallG',
      'stump_roundDetailed', 'log_large', 'mushroom_redGroup', 'flower_yellowA', 'flower_redB', 'flower_purpleA', 'grass_large', 'tent_detailedOpen', 'campfire_stones', 'fence_simple']
      .map(n => [P.nat, n, { recolor: t => natural(t) }]),
  ],
  city: [
    ...['building-a', 'building-c', 'building-e', 'building-h',
      'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-d'].map(n => [P.city, n, GLOWWIN]),
  ],
  space: [
    ...['rocket_baseA', 'rocket_fuelA', 'rocket_sidesA', 'rocket_finsA', 'rocket_topA', 'rocket_baseB', 'rocket_fuelB', 'rocket_topB', 'satelliteDish_large', 'satelliteDish_detailed',
      'hangar_largeA', 'hangar_roundA', 'hangar_smallA', 'machine_wireless', 'machine_generatorLarge', 'rock_crystalsLargeA', 'rock_crystalsLargeB', 'rock_largeA', 'rock_largeB', 'meteor_detailed',
      'rover', 'astronautA', 'craft_speederA', 'craft_cargoA', 'turret_double', 'structure_detailed', 'craterLarge', 'barrels']
      .map(n => [P.space, n, { recolor: t => natural(t, SPACE), cls: t => t.mat === 'crystal' ? 1 : 0 }]),
  ],
  home: [
    ...['kitchenFridgeLarge', 'kitchenCabinet', 'kitchenSink', 'kitchenStove', 'kitchenCabinetDrawer', 'kitchenMicrowave', 'kitchenCoffeeMachine', 'kitchenBlender', 'toaster', 'chair', 'chairCushion', 'table',
      'bedDouble', 'bedSingle', 'bear', 'books', 'bookcaseOpenLow', 'lampRoundFloor', 'loungeSofa', 'tableCoffee', 'televisionModern', 'cabinetTelevision', 'pottedPlant', 'speaker', 'cardboardBoxOpen', 'desk', 'chairDesk', 'laptop', 'pillowBlue', 'rugRound', 'trashcan', 'radio']
      .map(n => [P.furn, n, { recolor: t => { if (FURN[t.mat]) t.rgb = hex(FURN[t.mat]); }, cls: t => t.mat === 'lamp' ? 1 : /glass/i.test(t.mat) ? 2 : 0 }]),
    ...['apple', 'orange', 'banana', 'cup-coffee', 'mug', 'plate-dinner', 'loaf', 'bread', 'cheese', 'donut-sprinkles', 'cake', 'cupcake', 'pizza', 'watermelon', 'croissant', 'pancakes', 'frying-pan', 'pot',
      'cutting-board', 'bottle-ketchup', 'carton', 'honey', 'peanut-butter', 'utensil-fork', 'utensil-spoon', 'utensil-knife', 'soda-can', 'soda-bottle', 'burger', 'egg', 'cookie-chocolate', 'lemon', 'strawberry']
      .map(n => [P.food, n, {}]),
  ],
  race: [
    ...['grandStand', 'grandStandCovered', 'overheadLights', 'tentClosed', 'tent', 'flagCheckers', 'flagRed', 'flagGreen', 'lightPostModern', 'bannerTowerRed', 'bannerTowerGreen', 'pitsGarage', 'radarEquipment', 'pylon']
      .map(n => [P.race, n, { cls: t => /glass/i.test(t.mat) ? 2 : 0 }]),
  ],
};

function convert(dir, name, opt) {
  const file = path.join(ASSETS, dir, name + '.glb');
  const { tris } = readGLB(file);
  for (const t of tris) { // turn: model +z (front) -> game +x, model x -> game -z; keeps handedness
    for (const a of [t.pos, t.nor]) for (let k = 0; k < 9; k += 3) { const x = a[k], z = a[k + 2]; a[k] = z; a[k + 2] = -x; }
    if (opt.recolor) opt.recolor(t);
  }
  { // stand the model on y = 0, centred on x and z
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const t of tris) for (let k = 0; k < 9; k++) { mn[k % 3] = Math.min(mn[k % 3], t.pos[k]); mx[k % 3] = Math.max(mx[k % 3], t.pos[k]); }
    const sh = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
    for (const t of tris) for (let k = 0; k < 9; k++) t.pos[k] -= sh[k % 3];
  }
  let ref = null;
  if (opt.paint) { // the car's paint: the most-used saturated hue on the body
    const h = {}; for (const t of tris) { if (t.node.startsWith('wheel')) continue; const [hh, s, l] = hsl(t.rgb); if (s > .3 && l > .2) { const k = Math.round(hh / 10); h[k] = (h[k] || 0) + 1; } }
    const top = Object.entries(h).sort((a, b) => b[1] - a[1])[0]; ref = top ? [top[0] * 10] : null;
  }
  // parts: wheels separately (each centred on its hub), everything else together
  const groups = {};
  for (const t of tris) { const k = opt.wheels && t.node.startsWith('wheel') ? t.node : 'body'; (groups[k] = groups[k] || []).push(t); }
  const parts = [];
  for (const [pn, list] of Object.entries(groups)) {
    let c = [0, 0, 0];
    if (pn !== 'body') { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const t of list) for (let k = 0; k < 9; k++) { mn[k % 3] = Math.min(mn[k % 3], t.pos[k]); mx[k % 3] = Math.max(mx[k % 3], t.pos[k]); } c = mn.map((v, i) => (v + mx[i]) / 2); }
    const cls = [[], [], []];
    for (const t of list) cls[opt.cls ? opt.cls(t, ref) : 0].push(t);
    const verts = [], index = new Map(), idx = [], counts = [];
    let paintL = 0, paintN = 0;
    if (ref) for (const t of cls[1]) { paintL += lum(t.rgb); paintN++; }
    const refL = paintN ? paintL / paintN : 1;
    for (let ci = 0; ci < 3; ci++) {
      counts.push(cls[ci].length);
      for (const t of cls[ci]) {
        // paint is stored as a shade (relative brightness), so any colour can be put on it at run time
        const col = ci === 1 && ref ? [0, 0, 0].map(() => Math.min(255, Math.round(lum(t.rgb) / refL / 1.6 * 255))) : t.rgb;
        for (let k = 0; k < 3; k++) {
          const p = [t.pos[k * 3] - c[0], t.pos[k * 3 + 1] - c[1], t.pos[k * 3 + 2] - c[2]], n = t.nor.slice(k * 3, k * 3 + 3);
          const key = p.map(v => Math.round(v * 2000)).join() + '|' + n.map(v => Math.round(v * 60)).join() + '|' + col.join() + '|' + ci;
          let id = index.get(key);
          if (id == null) { id = verts.length; index.set(key, id); verts.push({ p, n, col }); }
          idx.push(id);
        }
      }
    }
    if (verts.length > 65535) throw new Error(name + ': too many vertices');
    parts.push({ n: pn, c, verts, idx, counts, shade: !!(ref && ci1(cls)) });
  }
  return parts;
}
const ci1 = cls => cls[1].length > 0;

fs.mkdirSync(OUT, { recursive: true });
for (const [bundle, list] of Object.entries(BUNDLES)) {
  const meta = {}, chunks = []; let off = 0;
  const push = (buf) => { const pad = (4 - buf.length % 4) % 4; const b = Buffer.concat([buf, Buffer.alloc(pad)]); chunks.push(b); const o = off; off += b.length; return o; };
  for (const [dir, name, opt] of list) {
    const parts = convert(dir, name, opt), mp = [];
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const pt of parts) for (const v of pt.verts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v.p[i] + pt.c[i]); mx[i] = Math.max(mx[i], v.p[i] + pt.c[i]); }
    for (const pt of parts) {
      let q = 0; for (const v of pt.verts) for (const x of v.p) q = Math.max(q, Math.abs(x)); q = q || 1;
      const pos = Buffer.alloc(pt.verts.length * 6), nor = Buffer.alloc(pt.verts.length * 3), col = Buffer.alloc(pt.verts.length * 3), ind = Buffer.alloc(pt.idx.length * 2);
      pt.verts.forEach((v, i) => { for (let k = 0; k < 3; k++) { pos.writeInt16LE(Math.round(v.p[k] / q * 32767), i * 6 + k * 2); nor.writeInt8(Math.round(v.n[k] * 127), i * 3 + k); col[i * 3 + k] = v.col[k]; } });
      pt.idx.forEach((v, i) => ind.writeUInt16LE(v, i * 2));
      mp.push({ n: pt.n, c: pt.c.map(v => +v.toFixed(4)), q: +q.toFixed(5), v: pt.verts.length, t: pt.counts, s: pt.shade ? 1 : 0, o: [push(pos), push(nor), push(col), push(ind)] });
    }
    meta[name] = { b: [...mn, ...mx].map(v => +v.toFixed(3)), p: mp };
  }
  const json = Buffer.from(JSON.stringify(meta)), jpad = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const head = Buffer.alloc(8); head.write('TKM1', 0); head.writeUInt32LE(json.length + jpad.length, 4);
  const out = Buffer.concat([head, json, jpad, ...chunks]);
  fs.writeFileSync(path.join(OUT, bundle + '.tkz'), require('zlib').gzipSync(out, { level: 9 })); // gzip; the game unpacks it with DecompressionStream
  console.log(bundle, list.length, 'models', (out.length / 1024).toFixed(0) + ' KB', 'gzip', (require('zlib').gzipSync(out, { level: 9 }).length / 1024).toFixed(0) + ' KB');
}
