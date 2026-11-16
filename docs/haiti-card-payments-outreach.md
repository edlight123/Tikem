# Accepting cards for Haiti events: outreach drafts

Send both from **Tikèm Support <support@tikem.co>** (the send-as in the info@edlight.org Gmail).
Fill in the [brackets] before sending.

---

## 1. Sogebank / SogePay (French)

**To:** SogePay merchant desk. There's no public email: call (509) 2229-5000 or (509) 2815-5000 and ask for "le service SogePay / affiliation commerçant", then ask which address to write to. Or bring this letter to your Sogebank branch.
**Subject:** Demande d'affiliation commerçant SogePay – Tikèm (billetterie en ligne)

Bonjour,

Nous sommes Tikèm (www.tikem.co), une plateforme haïtienne de billetterie en ligne pour concerts, soirées, festivals et événements culturels en Haïti et dans la diaspora. Nos acheteurs en Haïti paient aujourd'hui par MonCash, et nous souhaitons leur offrir aussi le paiement par carte (cartes Sogebank, Visa et Mastercard) via SogePay.

Nous souhaitons devenir commerçant affilié SogePay avec une intégration de notre site et de notre application mobile à votre passerelle. Pourriez-vous nous indiquer :

1. Les documents requis pour l'affiliation, ainsi que le formulaire d'adhésion commerçant.
2. Le compte bancaire requis : faut-il un compte entreprise Sogebank, en HTG, en USD ou les deux ?
3. La documentation technique de la passerelle : API ou page de paiement hébergée, environnement de test (sandbox), et confirmation des paiements par notification serveur (callback) avec signature.
4. La grille tarifaire commerçant (commission par transaction, frais d'installation ou mensuels) et les délais de règlement.
5. Les devises acceptées par transaction : HTG, USD, cartes émises à l'étranger.
6. Les règles applicables à une plateforme qui vend des billets pour le compte d'organisateurs : nous encaissons le paiement, puis reversons leur part aux organisateurs.

Notre entité : [nom légal de l'entité en Haïti], [NIF], [numéro de patente], [adresse]. Contact : [nom], [téléphone/WhatsApp].

Nous serions ravis de passer à votre agence ou d'organiser un appel cette semaine.

Merci d'avance,
[Nom]
Tikèm · www.tikem.co
support@tikem.co

---

## 2. Stripe support (English)

**Where:** Stripe Dashboard → Help → Contact support (account acct_1UCZeZRQFE6QeGQt, "Tikem"), so the request is tied to the account.
**Subject:** Can our platform charge cards for events in Haiti, where organizers can't onboard to Connect?

Hello,

We run Tikèm (www.tikem.co), a ticketing marketplace on a Canadian Stripe account (acct_1UCZeZRQFE6QeGQt, MCC 7922). In the US, Canada and France, organizers onboard as Connect accounts and we use destination charges.

Many of our events take place in Haiti. Haiti isn't a supported Connect country, so those organizers can't onboard. A large share of their buyers are in the diaspora and pay with US, Canadian and French cards. Today those buyers can only pay with MonCash.

We'd like to confirm what Stripe allows here:

1. Can our platform account be the merchant of record and charge cards for Haiti events, then pay the Haitian organizers outside Stripe (MonCash or bank transfer)? Does that model fit Stripe's terms for marketplaces, and what would you need from us (for example a review, a reserve, or an updated business description)?
2. Can cross-border payouts send funds to recipients in Haiti, now or on your roadmap?
3. Is there another structure you'd recommend for this case?

Expected volume: [estimate, e.g. "under US$X per month to start"], tickets typically US$40–150.

Thank you,
[Name]
Tikèm · www.tikem.co
