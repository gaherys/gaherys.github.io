// Vérifie sans navigateur : timing PAL, adresses RAM, vies infinies.
// Usage : node outils/test-smb.mjs "chemin/vers/Super Mario Bros.nes"
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { lireRom, recolorer, tempsEnSecondes, passerEnPal, viesInfinies, lireEtat, PERSOS } from "../jeux/smb/jeu.js";

const jsnes = createRequire(import.meta.url)("../vendor/jsnes.min.js");
const chemin = process.argv[2];
const rom = lireRom(readFileSync(chemin), chemin);
assert.ok(rom, "ROM reconnue comme Super Mario Bros");
console.log("PAL :", rom.pal);

let echantillons = 0;
const nes = new jsnes.NES({ onAudioSample: () => echantillons++, sampleRate: 48000 });
nes.loadROM(tempsEnSecondes(recolorer(rom, "wario"), rom.pal));
if (rom.pal) passerEnPal(nes);
const ram = nes.cpu.mem;
const B = jsnes.Controller;

const images = (n, f = () => {}) => { for (let i = 0; i < n; i++) { nes.frame(); viesInfinies(ram); f(i); } };

images(10);
echantillons = 0;
images(50);
const parImage = echantillons / 50;
console.log("échantillons son par image :", parImage, "(attendu", 48000 / (rom.pal ? 50 : 60.1) | 0, ")");
assert.ok(Math.abs(parImage - 48000 / (rom.pal ? 50.007 : 60.098)) < 3, "cadence audio cohérente");

// Écran titre → Start
images(60);
nes.buttonDown(1, B.BUTTON_START); images(5); nes.buttonUp(1, B.BUTTON_START);
const taches = new Set();
images(250, () => taches.add(`${ram[0x770]}/${ram[0x772]}`));
console.log("OperMode/tâche vus pendant l'intro :", [...taches].join(" "));
assert.equal(ram[0x770], 1, "en partie");
assert.equal(ram[0x772], 3, "boucle de jeu active");
console.log("motifs sprites en", nes.ppu.f_spPatternTable ? "$1000" : "$0000");

// TIME : 1 unité par seconde réelle
const temps = () => ram[0x7f8] * 100 + ram[0x7f9] * 10 + ram[0x7fa];
let t0 = temps(), k = 0;
while (temps() === t0) { images(1); k++; }
t0 = temps(); k = 0;
while (temps() === t0) { images(1); k++; }
console.log("images par unité de TIME :", k);
assert.equal(k, rom.pal ? 50 : 60, "le TIME suit les secondes réelles");

// Courir à droite pendant 3 s
const x0 = ram[0x6d] * 256 + ram[0x86];
nes.buttonDown(1, B.BUTTON_RIGHT); nes.buttonDown(1, B.BUTTON_B);
images(150);
const x1 = ram[0x6d] * 256 + ram[0x86];
const etat = lireEtat(ram);
console.log("x joueur", x0, "→", x1, "| état :", JSON.stringify(etat));
assert.ok(x1 > x0 + 100, "Mario avance");
assert.equal(etat.zone.slice(0, 3), "1-1");
assert.ok(etat.spr.length >= 4, "sprites du joueur trouvés");
const camX = ram[0x71a] * 256 + ram[0x71c];
assert.ok(Math.abs(etat.spr[0][0] - x1) < 16, "sprites à la position du joueur");
console.log("caméra", camX, "| couleurs sprite 0 en PPU :", [1, 2, 3].map((i) => nes.ppu.vramMem[0x3f10 + i].toString(16)), "attendu wario", PERSOS.wario.couleurs.map((c) => c.toString(16)));

// Mourir plusieurs fois : la partie ne doit jamais finir
let viesMin = 9;
images(50 * 60, () => { viesMin = Math.min(viesMin, ram[0x75a]); });
console.log("vies minimum vues :", viesMin, "| OperMode final :", ram[0x770], "| zone", lireEtat(ram).zone);
assert.notEqual(ram[0x770], 3, "pas de game over");
console.log("palette jsnes, couleur 0x16 =", nes.ppu.palTable.curTable[0x16].toString(16));
console.log("OK");
