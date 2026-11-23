import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { piFmt } from '../util.js';
import { ClientShell } from '../components/Layout.jsx';
import { useAsync, Spinner } from '../components/ui.jsx';
import { useConfig } from '../state.jsx';

function Delivery() {
  const { data, loading } = useAsync(() => api.get('/api/geo/served'), []);
  return (
    <>
      <h1>Livraisons</h1>
      <p>GÉEJ MARKET est conçu pour couvrir progressivement les 14 régions du Sénégal. Chaque vendeur choisit les zones qu’il dessert, ses frais et ses délais : une zone non desservie vous est clairement signalée avant la commande.</p>
      <h2>Zones actuellement desservies</h2>
      {loading && <Spinner />}
      {data && !data.served.length && <p>Aucune zone n’est encore ouverte.</p>}
      {data?.served.length > 0 && <div className="tablewrap"><table className="t"><thead><tr><th>Région</th><th>Frais à partir de</th><th>Retrait</th></tr></thead><tbody>{data.served.map((r) => <tr key={r.region_id}><td>{r.name}</td><td>{piFmt(r.min_fee)}</td><td>{r.pickup ? 'Oui' : 'Non'}</td></tr>)}</tbody></table></div>}
      <h2>Modes de livraison</h2>
      <ul><li>Livraison à domicile ou à une adresse professionnelle</li><li>Retrait à un point de vente ou de distribution (selon les vendeurs)</li></ul>
      <h2>Chaîne du froid</h2>
      <p>Les produits périssables sont conditionnés et transportés selon les règles d’hygiène et de conservation du vendeur. Pensez à être présent à l’heure de livraison annoncée pour conserver la fraîcheur des produits.</p>
    </>
  );
}
const Cgv = () => (
  <>
    <h1>Conditions générales de vente</h1>
    <p className="notice warn small">Texte modèle à faire valider par un juriste avant le lancement commercial.</p>
    <h2>1. Objet</h2><p>GÉEJ MARKET est une plateforme qui met en relation des clients et des vendeurs de produits halieutiques. Le contrat de vente est conclu entre le client et le vendeur.</p>
    <h2>2. Prix et poids</h2><p>Tous les prix sont indiqués en Pi (π), sans autre monnaie. Pour les produits vendus au poids, le montant affiché est estimatif : le vendeur confirme le montant final après pesée.</p>
    <h2>3. Commande</h2><p>Une commande est enregistrée à sa validation et traitée par le vendeur, qui peut l’accepter ou la refuser (rupture, zone non desservie…). Elle n’est jamais considérée comme payée sans confirmation effective du paiement.</p>
    <h2>4. Paiement</h2><p>Le paiement se fait uniquement en Pi (π), dans Pi Browser avec votre compte Pi. Une commande n’est considérée comme payée qu’après vérification côté serveur de la transaction : la commande et le paiement sont deux étapes distinctes.</p>
    <h2>5. Livraison et annulation</h2><p>Les délais sont indicatifs. Le client peut annuler en ligne tant que la commande n’est pas confirmée par le vendeur. Au-delà, contactez le vendeur ou le service client.</p>
    <h2>6. Réclamations</h2><p>Toute réclamation peut être déposée depuis l’espace « Compte » ou depuis la commande concernée.</p>
  </>
);
const Privacy = () => (
  <>
    <h1>Politique de confidentialité</h1>
    <p className="small muted">Dernière mise à jour : 23 novembre 2026</p>
    <h2>1. Responsable du traitement</h2>
    <p>Safietou Dîedhiou, éditeur de GÉEJ MARKET (Sénégal) — safietoudiedhiou05@gmail.com.</p>
    <h2>2. Données collectées</h2>
    <ul>
      <li>Compte Pi : identifiant Pi (uid) et nom d’utilisateur, reçus de Pi Network à la connexion.</li>
      <li>Commande : nom, téléphone, adresse de livraison, position GPS (facultative, uniquement si vous la partagez), produits commandés.</li>
      <li>Paiement : référence du paiement Pi, identifiant de transaction (txid), montant et statut. Aucun autre moyen de paiement n’existe.</li>
      <li>Technique : journaux de sécurité (actions sur le compte, adresse IP).</li>
    </ul>
    <h2>3. Ce que nous ne collectons jamais</h2>
    <p>Votre phrase secrète (passphrase), votre clé privée ou votre mot de passe Pi. Ne les communiquez jamais, ni à nous ni à quiconque.</p>
    <h2>4. Finalités</h2>
    <p>Authentifier votre compte Pi, traiter et livrer vos commandes, vérifier les paiements, établir les reçus, traiter les réclamations et remboursements, et sécuriser la plateforme.</p>
    <h2>5. Destinataires</h2>
    <ul>
      <li>Le vendeur concerné par votre commande reçoit le nom, le téléphone et l’adresse nécessaires à la livraison.</li>
      <li>Pi Network traite les données de connexion et de paiement selon la politique de confidentialité de Pi Network.</li>
      <li>Nos prestataires techniques d’hébergement (serveur et base de données).</li>
    </ul>
    <p>Vos données ne sont ni vendues ni utilisées pour de la publicité.</p>
    <h2>6. Conservation</h2>
    <p>Les données de commande et de paiement sont conservées le temps nécessaire à la livraison, aux réclamations et aux obligations légales, puis supprimées ou anonymisées.</p>
    <h2>7. Sécurité</h2>
    <p>Connexion chiffrée (HTTPS), accès à la base de données réservé au serveur, vérification des paiements côté serveur.</p>
    <h2>8. Vos droits</h2>
    <p>Vous pouvez demander l’accès, la rectification ou la suppression de vos données en écrivant à l’adresse e-mail ci-dessus ou par une réclamation depuis votre compte.</p>
    <h2>9. Modifications</h2>
    <p>Cette politique peut évoluer ; la date de mise à jour figure en haut de la page.</p>
  </>
);
const Terms = () => (
  <>
    <h1>Conditions d’utilisation</h1>
    <p className="small muted">Dernière mise à jour : 23 novembre 2026</p>
    <h2>1. Acceptation</h2>
    <p>En vous connectant à GÉEJ MARKET, vous acceptez les présentes conditions, les <a href="/infos/cgv">conditions générales de vente</a> et la <a href="/infos/confidentialite">politique de confidentialité</a>.</p>
    <h2>2. Service</h2>
    <p>GÉEJ MARKET est une application de vente de produits de la mer au Sénégal, utilisable dans Pi Browser. Elle est indépendante de Pi Network, qui ne l’édite ni ne la garantit.</p>
    <h2>3. Compte</h2>
    <p>L’accès se fait uniquement avec votre compte Pi. Vous êtes majeur et responsable de votre compte ; vous ne communiquez jamais votre phrase secrète ou votre clé privée.</p>
    <h2>4. Paiement en Pi</h2>
    <p>Les prix et paiements sont exclusivement en Pi (π). Une commande n’est payée qu’après confirmation du paiement sur la blockchain Pi. Les transactions sur la blockchain sont irréversibles : un remboursement éventuel est effectué manuellement par l’éditeur.</p>
    <h2>5. Usage interdit</h2>
    <p>Il est interdit de fournir de fausses informations, de tenter de contourner un paiement, de perturber le service ou d’usurper l’identité d’autrui. Un compte peut être suspendu en cas d’abus.</p>
    <h2>6. Responsabilité</h2>
    <p>Le contrat de vente est conclu entre le client et le vendeur. Dans la mesure permise par la loi, l’éditeur n’est pas responsable des interruptions dues à Pi Network, à l’hébergement ou au réseau.</p>
    <h2>7. Droit applicable et contact</h2>
    <p>Droit sénégalais. Contact : safietoudiedhiou05@gmail.com.</p>
  </>
);
function Contact() {
  const cfg = useConfig();
  return (
    <>
      <h1>Nous contacter</h1>
      {cfg.support_phone ? <ul>{cfg.support_phone && <li>Téléphone : {cfg.support_phone}</li>}</ul> : <p>Utilisez le formulaire de réclamation de votre espace « Compte ».</p>}
    </>
  );
}
function Legal() {
  return (
    <>
      <h1>Informations légales</h1>
      <h2>1. Éditeur de l’application</h2>
      <ul>
        <li>Application : GÉEJ MARKET — Le marché de la mer</li>
        <li>Nom : Safietou Dîedhiou</li>
        <li>Nom d’utilisateur Pi : famaa773239225</li>
        <li>E-mail : safietoudiedhiou05@gmail.com</li>
        <li>Pays : Sénégal</li>
      </ul>
      <h2>2. Application Pi Network</h2>
      <p>GÉEJ MARKET est une application tierce fonctionnant dans Pi Browser, avec le SDK et la plateforme de paiement de Pi Network. Elle est éditée et exploitée de manière indépendante : elle n’est ni éditée, ni approuvée, ni garantie par Pi Network ou la Pi Core Team. L’éditeur s’engage à respecter les conditions d’utilisation de Pi Network et les conditions applicables aux développeurs.</p>
      <h2>3. Monnaie</h2>
      <p>Tous les prix sont en Pi (π), sans autre monnaie ni conversion. Les paiements sont effectués sur Pi Network (Mainnet) et sont irréversibles.</p>
      <h2>4. Connexion et sécurité du compte Pi</h2>
      <ul>
        <li>La connexion se fait uniquement avec votre compte Pi, dans Pi Browser.</li>
        <li>Nous ne demandons et ne conservons jamais votre phrase secrète (passphrase) ni votre clé privée. Ne les communiquez à personne.</li>
        <li>Nous recevons de Pi votre identifiant Pi et votre nom d’utilisateur .</li>
      </ul>
      <h2>5. Paiements</h2>
      <p>Le paiement se fait uniquement en Pi (π). Le montant est fixé par le serveur ; vous validez le paiement dans votre portefeuille Pi. Une commande n’est considérée comme payée qu’après vérification de la transaction sur la blockchain Pi : la commande et le paiement sont deux opérations distinctes. Un reçu de paiement est délivré ; il est à présenter à la livraison.</p>
      <h2>6. Livraison, annulation et remboursement</h2>
      <p>Les délais sont indicatifs. Si une commande payée est refusée par le vendeur, un remboursement en Pi est traité manuellement par l’éditeur après vérification.</p>
      <h2>7. Données personnelles</h2>
      <p>Données traitées : identifiant et nom d’utilisateur Pi, nom, téléphone et adresse de livraison, historique de commandes et de paiements. Elles servent uniquement à traiter, livrer et sécuriser vos commandes, et ne sont pas vendues. Voir la <a href="/infos/confidentialite">politique de confidentialité</a>. Les données traitées par Pi Network sont soumises à la <a href="https://minepi.com/privacy" target="_blank" rel="noreferrer">politique de confidentialité de Pi Network</a>.</p>
      <h2>8. Utilisateurs</h2>
      <p>L’application s’adresse aux personnes majeures disposant d’un compte Pi. Toute utilisation frauduleuse peut entraîner la suspension du compte.</p>
      <h2>9. Réclamations et contact</h2>
      <p>Pour toute commande non livrée ou tout problème, déposez une réclamation depuis votre compte ou écrivez à l’adresse e-mail ci-dessus. Voir aussi les <a href="/infos/cgv">conditions générales de vente</a>.</p>
    </>
  );
}
const PAGES = { livraison: Delivery, cgv: Cgv, confidentialite: Privacy, conditions: Terms, contact: Contact, legal: Legal };

export default function Info() {
  const { page } = useParams();
  const C = PAGES[page] || Contact;
  return <ClientShell><div className="legal" style={{ maxWidth: 760, margin: '0 auto' }}><C /></div></ClientShell>;
}
