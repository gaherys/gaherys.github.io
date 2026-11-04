// Réglages communs à tous les jeux (pseudo, salon) + connexion en ligne.
// Les jeux s'échangent leurs messages via un relais MQTT public : ça passe partout (4G, box…)
// sans rien héberger, puisque ce sont les navigateurs qui vont vers le relais.
// shortcut: un seul relais public gratuit sans garantie ; s'il tombe, en mettre un autre ici (les deux joueurs doivent être sur le même)
// Mesuré le 2026-11-04 : il ne laisse passer que 10 messages/s par joueur (le reste est jeté sans prévenir),
// donc les jeux regroupent leurs données pour rester vers 7 messages/s.
const RELAIS = "wss://broker.emqx.io:8084/mqtt";

function lire(cle, defaut) {
  try {
    return localStorage.getItem(cle) || defaut;
  } catch {
    return defaut;
  }
}

function ecrire(cle, valeur) {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // stockage bloqué : le réglage ne durera que le temps de la page
  }
}

export const nettoyerSalon = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);

// Un lien ?salon=xxx (envoyé par un pote) remplace le salon enregistré.
let salonActuel = nettoyerSalon(new URLSearchParams(location.search).get("salon") || lire("salon", ""));
if (!salonActuel) salonActuel = "salon-" + Math.floor(1000 + Math.random() * 9000);
ecrire("salon", salonActuel);

let pseudoActuel = lire("pseudo", "") || "Joueur " + Math.floor(10 + Math.random() * 90);
ecrire("pseudo", pseudoActuel);

export const salon = () => salonActuel;
export const pseudo = () => pseudoActuel;
export function changerSalon(s) {
  salonActuel = nettoyerSalon(s) || salonActuel;
  ecrire("salon", salonActuel);
  return salonActuel;
}
export function changerPseudo(p) {
  pseudoActuel = String(p).trim().slice(0, 16) || pseudoActuel;
  ecrire("pseudo", pseudoActuel);
  return pseudoActuel;
}
export const lienInvitation = () => new URL(`../?salon=${salonActuel}`, new URL("./", import.meta.url)).href;

// Rejoint le salon pour un jeu donné. `recevoir(message)` est appelé pour chaque message
// d'un AUTRE joueur (données non fiables : à valider avant usage).
export function rejoindre(jeu, recevoir) {
  const moi = Math.random().toString(36).slice(2, 10);
  const sujet = `salle-de-jeux/${salonActuel}/${jeu}`;
  const client = mqtt.connect(RELAIS, { reconnectPeriod: 2000 });
  client.on("connect", () => client.subscribe(sujet, { qos: 1 }));
  client.on("message", (_, donnees) => {
    let m;
    try {
      m = JSON.parse(donnees);
    } catch {
      return;
    }
    if (m && typeof m === "object" && typeof m.id === "string" && m.id !== moi) recevoir(m);
  });
  return {
    id: moi,
    // fiable : le relais accuse réception et le message est renvoyé si besoin (pour les messages rares et importants)
    envoyer(m, fiable = false) {
      if (client.connected) client.publish(sujet, JSON.stringify({ ...m, id: moi, pseudo: pseudoActuel }), { qos: fiable ? 1 : 0 });
    },
    connecte: () => client.connected,
  };
}
