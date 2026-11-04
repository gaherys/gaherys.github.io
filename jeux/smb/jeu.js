// Super Mario Bros : tout ce qui touche à l'émulateur, sans rien de la page.
// Adresses RAM tirées du désassemblage de SMB1 (les mêmes en version US et européenne).

export const PERSOS = {
  mario: { nom: "Mario", couleurs: [0x16, 0x27, 0x18] },
  luigi: { nom: "Luigi", couleurs: [0x30, 0x27, 0x19] },
  wario: { nom: "Wario", couleurs: [0x28, 0x27, 0x14] },
  waluigi: { nom: "Waluigi", couleurs: [0x13, 0x27, 0x03] },
};
// Couleurs NES : [casquette + salopette, peau, cheveux + chemise + chaussures]
const COULEURS_FEU = [0x37, 0x27, 0x16];
const TABLE_COULEURS = [0x22, 0x16, 0x27, 0x18, 0x22, 0x30, 0x27, 0x19]; // Mario puis Luigi, dans la ROM

function chercher(octets, motif) {
  for (let i = 0; i <= octets.length - motif.length; i++) {
    if (motif.every((v, k) => octets[i + k] === v)) return i;
  }
  return -1;
}

// null si ce n'est pas une ROM de Super Mario Bros.
export function lireRom(donnees, nomFichier = "") {
  const octets = new Uint8Array(donnees);
  if (String.fromCharCode(...octets.subarray(0, 4)) !== "NES\x1a") return null;
  const table = chercher(octets, TABLE_COULEURS);
  if (table < 0) return null;
  const nes2 = (octets[7] & 0x0c) === 0x08;
  const pal = nes2 ? (octets[12] & 3) === 1 : (octets[9] & 1) === 1 || /europe|\(e\)/i.test(nomFichier);
  return { octets, table, pal, chr: octets.subarray(16 + octets[4] * 16384) };
}

// Copie de la ROM où la tenue de Mario prend les couleurs du perso choisi.
export function recolorer(rom, perso) {
  const copie = rom.octets.slice();
  copie.set(PERSOS[perso].couleurs, rom.table + 1);
  return copie;
}

// Sur NES, le TIME perd 1 unité toutes les 0,4 s (20 images PAL, 24 NTSC), réglé par `lda #n / sta $0787`.
// Ici 1 unité = 1 seconde réelle : n = images par seconde. La vitesse du jeu ne change pas.
export function tempsEnSecondes(octets, pal) {
  for (let i = 0; i < octets.length - 4; i++) {
    if (octets[i] === 0xa9 && octets[i + 2] === 0x8d && octets[i + 3] === 0x87 && octets[i + 4] === 0x07) {
      octets[i + 1] = pal ? 50 : 60;
    }
  }
  return octets;
}

// jsnes n'émule que la NES américaine. La NES européenne a 312 lignes par image (50 Hz)
// et un processeur un peu plus lent (3,2 points d'écran par cycle au lieu de 3).
export function passerEnPal(nes) {
  nes.pal = true;
  const ppu = Object.getPrototypeOf(nes.ppu);
  if (!ppu.finLigneNtsc) {
    ppu.finLigneNtsc = ppu.endScanline;
    ppu.endScanline = function () {
      // ligne 10 = en plein vblank : on la rejoue 50 fois pour passer de 262 à 312 lignes
      if (this.nes.pal && this.scanline === 10 && (this.lignesPal | 0) < 50) {
        this.lignesPal = (this.lignesPal | 0) + 1;
        this.regsToAddress();
        this.cntsToAddress();
        return;
      }
      if (this.scanline === 10) this.lignesPal = 0;
      this.finLigneNtsc();
    };
    ppu.pointsNtsc = ppu.advanceDots;
    ppu.advanceDots = function (points) {
      if (this.nes.pal && points === 3 && (this.cyclePal = ((this.cyclePal | 0) + 1) % 5) === 0) points = 4;
      this.pointsNtsc(points);
    };
  }
  // le son doit suivre l'horloge PAL (1,662607 MHz) pour que la musique ne sonne pas faux
  nes.papu.sampleTimerMax = Math.floor((1024 * 1662607) / nes.opts.sampleRate);
}

// À appeler à chaque image : remet les vies à 3 dès qu'il en manque.
export function viesInfinies(ram) {
  if (ram[0x770] === 1 && ram[0x75a] < 2) ram[0x75a] = 2;
}

export function cameraX(ram) {
  return ram[0x71a] * 256 + ram[0x71c];
}

// Ce que les autres joueurs ont besoin de savoir pour dessiner notre perso.
export function lireEtat(ram) {
  if (ram[0x770] !== 1 || ram[0x772] !== 3) return { zone: null }; // menu, écran de niveau…
  const camX = cameraX(ram);
  const debut = 0x200 + ram[0x6e4];
  const spr = [];
  for (let a = debut; a < debut + 32; a += 4) {
    // 0xFC = tuile vide (haut du petit Mario) : inutile à envoyer
    if (ram[a] < 0xef && ram[a + 1] !== 0xfc) spr.push([camX + ram[a + 3], ram[a] + 1, ram[a + 1], ram[a + 2]]);
  }
  return {
    zone: `${ram[0x75f] + 1}-${ram[0x75c] + 1}-${ram[0x750]}`,
    feu: ram[0x756] === 2,
    spr,
  };
}

export function couleursDe(etat, palette) {
  const indices = etat.feu ? COULEURS_FEU : (PERSOS[etat.perso]?.couleurs ?? PERSOS.mario.couleurs);
  return indices.map((i) => {
    const v = palette[i] ?? 0; // jsnes range ses couleurs en 0xBBGGRR
    return `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`;
  });
}

// Dessine des sprites 8×8 de la ROM. `spr` vient du réseau : chaque valeur est bornée.
export function dessinerSprites(ctx, chr, couleurs, spr, decalageX, decalageY = 0) {
  for (const s of Array.isArray(spr) ? spr.slice(0, 8) : []) {
    const [wx, wy, tuile, attr] = Array.isArray(s) ? s.map((v) => v | 0) : [];
    const x = wx - decalageX;
    const y = wy + decalageY;
    if (x < -8 || x > 256) continue;
    const base = (tuile & 0xff) * 16;
    for (let py = 0; py < 8; py++) {
      const ly = attr & 0x80 ? 7 - py : py;
      for (let px = 0; px < 8; px++) {
        const lx = attr & 0x40 ? px : 7 - px;
        const c = ((chr[base + ly] >> lx) & 1) | (((chr[base + ly + 8] >> lx) & 1) << 1);
        if (c) {
          ctx.fillStyle = couleurs[c - 1];
          ctx.fillRect(x + px, y + py, 1, 1);
        }
      }
    }
  }
}

// Grand Mario debout (tuiles 0 à 7), pour les vignettes de choix du perso.
export const MARIO_DEBOUT = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => [(t % 2) * 8, (t >> 1) * 8, t, 0]);
