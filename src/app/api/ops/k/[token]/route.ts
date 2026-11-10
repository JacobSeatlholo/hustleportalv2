import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getConfig, setConfig } from '@/lib/config'
import { addCredits, ensureWallet } from '@/lib/wallet'
import { writeCampaignState, type CampaignState } from '@/lib/campaignqueue'
import { identityFromLabel, isSesConfigured } from '@/lib/mailer'
import { sanitizeBrand } from '@/lib/mailthemes'
import { planState } from '@/lib/limits'
import { PLAN_SEND_BUNDLES, DEFAULT_SEND_BUNDLE, SEND_BUNDLE_WINDOW_DAYS, SPEND_ACTIONS } from '@/lib/spend'

// ONE-SHOT OPS DOOR (Task 146/181/184/186 pattern, sixth lawful run).
// Boss order: "Cue the campaign up for me" + "load R1500 credit on it" +
// "Start campaign button ... accessible to all paying users, unpaid prompt to
// upgrade" (the UI law shipped separately in the same deploy).
//
// READ  (GET, read token): dry run only. Account facts, plan, wallet, booking
//       link, suppression overlap, dedupe counts, airtime math. Touches nothing.
// WRITE (POST, write token): one request, then a lock:
//       1. businessName -> "Ubuntu Wellness" (the sender identity law).
//       2. Operator (HUSTLER) subscription set ACTIVE when the account is not
//          currently paying (Start campaign is a paying-user control).
//       3. +R1,500 airtime credited at the platform's own ladder law
//          (R1,500 + 10% Growth bonus = R1,650 lands; one TOPUP ledger row).
//       4. Fresha clients imported as unlocked Leads on THIS account
//          (company = full name, contactName = first name, source CSV).
//       5. Queue u-ubuntu-november-offer staged BORN PAUSED: goldrush look
//          wearing the Ubuntu Wellness brand (no BH chrome anywhere), 45 per
//          hour, first-name greeting per row, suppression + duplicate laws
//          honoured. Nothing sends until Start is pressed in the app.
//       A platformConfig marker records the run and refuses a second one.
//       The door is deleted right after use; the marker is the audit record.

const READ_TOKEN = 'ubx-ff83a38f20a66bfa873f10ee'
const WRITE_TOKEN = 'ubx-47b81574488cba025d690e80'
const MARKER_KEY = 'ops_ubuntu_wave1_cue_2026_11_lock'

const ACCOUNT_EMAIL = 'support@ubuntuwellness.com'
const BUSINESS_NAME = 'Ubuntu Wellness'
const TAG = 'u-ubuntu-november-offer'
const SUBJECT = '15% off your next visit at Ubuntu Wellness'
const PER_HOUR = 45
const LOAD_CENTS = 150_000 // R1,500 boss load
const GROWTH_BONUS_PCT = 10 // spend.ts TOPUP_BONUS_TIERS: R1,500+ -> 10%

// The boss-approved Wave 1 segment: real clients, marketing yes, blocklist
// parked, junk stripped (scripts/analyze_customer_list.py + segment pass).
const RECIPIENTS: { n: string; e: string }[] = [{"n": "Natalie Wittwen", "e": "natalie.wittwen@gmail.com"}, {"n": "Nathaly Zambrano", "e": "zambrano.nathaly@gmail.com"}, {"n": "Rahma Robertson", "e": "rahma.robertson@gmail.com"}, {"n": "Elif Isabella İlhan", "e": "e.ilhan95@gmail.com"}, {"n": "Armand Du Plessis", "e": "facebook@thesven.co"}, {"n": "Ana Corrochano", "e": "anacorrochano@hotmail.com"}, {"n": "Heidi Malherbe", "e": "heidi.malherbe@gmail.com"}, {"n": "Ryanah Saeed", "e": "fayy.rayy8@gmail.com"}, {"n": "Andrea Vanek", "e": "andreameyer@gmail.com"}, {"n": "Joel Bronkowski", "e": "joelbronkowski@gmail.com"}, {"n": "Sarah H.", "e": "sarah.hensiek@gmail.com"}, {"n": "Vicky Hyland", "e": "hylandv@stcyprians.co.za"}, {"n": "Nicole Joubert", "e": "nixxx.j@gmail.com"}, {"n": "eir storrustløkken", "e": "20eir.sto@gmail.com"}, {"n": "Rebecca Smith", "e": "rhc.smith00@gmail.com"}, {"n": "Mfundo Tekiso", "e": "tekisom2409@gmail.com"}, {"n": "Elzarie Theron", "e": "elzarietheron@gmail.com"}, {"n": "Richard Pieterse", "e": "richard.l.pieterse@gmail.com"}, {"n": "Yolisa Mjamba", "e": "yolisa03@gmail.com"}, {"n": "Chandini Bundhun-Ragnuth", "e": "dr_cbundhun@yahoo.com"}, {"n": "Yanelisa Pulani", "e": "plnyan001@myuct.ac.za"}, {"n": "Desiree Keep", "e": "dez@destinationdreamersbydez.com"}, {"n": "Johanna KUUSISTO", "e": "jkuusisto83@gmail.com"}, {"n": "Cheryl Arthur", "e": "cherylarthur439@gmail.com"}, {"n": "Jared O'Sullivan", "e": "contact@jaredosullivan.com"}, {"n": "Markus Siro", "e": "markuz.ziro@gmail.com"}, {"n": "shevaun von memerty", "e": "shevaun.33@gmail.com"}, {"n": "Daniel Keller", "e": "daniel.phil.hock@gmail.com"}, {"n": "David Turvey", "e": "dave.turvey@gmail.com"}, {"n": "grace maybery", "e": "gracemaybery@gmail.com"}, {"n": "Donggyun Kang", "e": "tongooon@gmail.com"}, {"n": "Anaïs DESBOS", "e": "anais.desbos@gmail.com"}, {"n": "Pamela Meyer", "e": "tridore1@gmail.com"}, {"n": "Stephanie Jäger", "e": "stephanie.jaeger.privat@gmail.com"}, {"n": "Kalmer J", "e": "realworldaiprofessional@gmail.com"}, {"n": "Anne Thomopoulos", "e": "annethomopoulos@mac.com"}, {"n": "Tickle M", "e": "tmhlambiso1@gmail.com"}, {"n": "Jens Uwe Ebsen", "e": "jensu.ebsen@t-online.de"}, {"n": "Borach Jansema", "e": "smug_90rob@icloud.com"}, {"n": "Larnike Pretorius", "e": "42gvd8k4vg@privaterelay.appleid.com"}, {"n": "elton dick", "e": "eltondick@gmail.com"}, {"n": "Natalie Corin", "e": "gillottna@gmail.com"}, {"n": "Colin Mitchell", "e": "colin.mitchell1000@gmail.com"}, {"n": "Chloe Blyth", "e": "chloefblyth@gmail.com"}, {"n": "Shalini Kellinghaus", "e": "shalinikellinghaus@gmail.com"}, {"n": "Richie Carroll", "e": "richiecarroll65@gmail.com"}, {"n": "Ellen Gaffert", "e": "ellengaffert@hotmail.com"}, {"n": "Michael Schumacher", "e": "schumacherms1@gmx.de"}, {"n": "Kurt Henderson", "e": "kurthenderson1@gmail.com"}, {"n": "David Brits", "e": "dnbrits@gmail.com"}, {"n": "Gina Nadine Brown", "e": "ginanbrown@me.com"}, {"n": "Ismayilov Tarlan", "e": "gb4fntbxgk@privaterelay.appleid.com"}, {"n": "Lisah Mpofu", "e": "lisahlee07@gmail.com"}, {"n": "Rudo Martin", "e": "rudomartin.rm@gmail.com"}, {"n": "Mel Dreyer", "e": "dreyermelodia@gmail.com"}, {"n": "Aphiwe Tshele", "e": "aphiwetshele1@gmail.com"}, {"n": "Aléz Odendaal", "e": "alezodendaal@gmail.com"}, {"n": "Alex Rashida Monteiro", "e": "storm210012@gmail.com"}, {"n": "Madelyn Duhon", "e": "duhonmadelyn@gmail.com"}, {"n": "Nicholas Wilding", "e": "yhnwy5bfgf@privaterelay.appleid.com"}, {"n": "Helene Brunstering", "e": "lene.brunstering@googlemail.com"}, {"n": "Zamavundla Duze", "e": "rv9vvmg55p@privaterelay.appleid.com"}, {"n": "meghan hughes-hallett", "e": "meghan_coco@hotmail.com"}, {"n": "Courtney Rocks", "e": "courtsrocks@hotmail.co.uk"}, {"n": "Tony Dallas", "e": "tonydallas11@gmail.com"}, {"n": "Amelie Gerard", "e": "amelieg2002@gmail.com"}, {"n": "Rob Spronken", "e": "rhlspronken@gmail.com"}, {"n": "Leonie Walters", "e": "leoniewalters15@gmail.com"}, {"n": "Nick Dillard", "e": "nick.b.dillard@gmail.com"}, {"n": "Stewart Gray", "e": "stewartgraysa@gmail.com"}, {"n": "Sabrina Black", "e": "qs85r5j5qb@privaterelay.appleid.com"}, {"n": "Ingrid A Ngounou d'Halluin", "e": "ingrid.dhalluin1@gmail.com"}, {"n": "Attila Oezel", "e": "attila10@bluewin.ch"}, {"n": "Nele Roppe", "e": "roppenele@gmail.com"}, {"n": "Alex Mercadé González", "e": "alexmercade98@gmail.com"}, {"n": "Xenia Schlingelhof", "e": "xenia.schlingelhof@gmail.com"}, {"n": "Renée Hunter", "e": "reneeshunter@gmail.com"}, {"n": "Justine Fargher", "e": "justine.fargher@gmail.com"}, {"n": "Enya Pooler", "e": "enyaalison@gmail.com"}, {"n": "Imke Sonnemans", "e": "imke.sonnemans@gmail.com"}, {"n": "Rhett Delaney", "e": "rhett.delaney@gmail.com"}, {"n": "Philip van Berkom", "e": "philipvanberkom@gmail.com"}, {"n": "Joen Tang", "e": "joentang1@gmail.com"}, {"n": "Lebohang Storom", "e": "dlstorom@gmail.com"}, {"n": "Matthias Scriba", "e": "matthias.scriba@gmail.com"}, {"n": "Thando Ndaleni", "e": "ndalenithando@gmail.com"}, {"n": "Rhyno Meyer", "e": "rhynomeyer86@gmail.com"}, {"n": "Jennifer Knight", "e": "jennbrandt8915@gmail.com"}, {"n": "بشار الحارثي", "e": "basharalharethi@gmail.com"}, {"n": "Marleen van Dam", "e": "marleenbeyer@hotmail.com"}, {"n": "Michael Dodd", "e": "mdodd1@gmail.com"}, {"n": "Ashlyn Jones", "e": "88ashlyn@gmail.com"}, {"n": "Brittany Ferreira", "e": "brittanyferreira98@gmail.com"}, {"n": "Jonathan Elcock", "e": "jono.elcock@gmail.com"}, {"n": "Catalina Gutman", "e": "gutman.catalina@gmail.com"}, {"n": "Katherine De villiers", "e": "katherinedevilliers16@gmail.com"}, {"n": "Rahma Djuma", "e": "rahmadjuma07@gmail.com"}, {"n": "Fazila Manjoo", "e": "fazila.manjoo@gmail.com"}, {"n": "Greg Morgan", "e": "gregjamesmorgan@gmail.com"}, {"n": "Thoko Mjoli", "e": "thokomjoli197@gmail.com"}, {"n": "Mduduzi Shelembe", "e": "mduduzis39@gmail.com"}, {"n": "Anja Human", "e": "avds91@gmail.com"}, {"n": "Jana Kordt", "e": "janakordt@gmail.com"}, {"n": "Khalifa Al-Qamzi", "e": "qamzi90@gmail.com"}, {"n": "Yashna Garach", "e": "yashna.garach@gmail.com"}, {"n": "Tony Snyders", "e": "snyderstony@gmail.com"}, {"n": "Stephanie Lourenço", "e": "stephirons@gmail.com"}, {"n": "Greg Prentice", "e": "gskprentice@gmail.com"}, {"n": "Sizwe Ntshangase", "e": "sizwetao@gmail.com"}, {"n": "Adair Matthew", "e": "matt-adair2022@gmail.com"}, {"n": "Megan Moore", "e": "meganemoore@gmail.com"}, {"n": "carissa swart", "e": "cvanrhyn8@gmail.com"}, {"n": "Saffron Graham", "e": "saffrongraham@gmail.com"}, {"n": "Adelle Nugent", "e": "adelle.nug@gmail.com"}, {"n": "Nikita de Bruyn", "e": "keetsdebruyn@gmail.com"}, {"n": "Annika Surmeier", "e": "annika_surmeier@gmx.de"}, {"n": "Xoliswa Tokwe", "e": "xoliswatokwe@gmail.com"}, {"n": "Jacqueline Guidry", "e": "jguidry55@att.net"}, {"n": "Hélène Ponzoni", "e": "ponzonih@gmail.com"}, {"n": "Daniella Dobie", "e": "d.dobie16@gmail.com"}, {"n": "Kristen Purvis", "e": "kristen.purvis@gmail.com"}, {"n": "Martha Luz Correa Bahamon", "e": "marthaluzco58@gmail.com"}, {"n": "Sarah MICHOT", "e": "sarah.michot@sciencespo.fr"}, {"n": "Bongi Duma", "e": "peronna24@yahoo.com"}, {"n": "Andile Cele", "e": "celeandile47@gmail.com"}, {"n": "Daleen Hankey", "e": "4gq89bhpj9@privaterelay.appleid.com"}, {"n": "Lisanne Pennards", "e": "lisannepennards@live.nl"}, {"n": "Smuts De Manielle", "e": "smutsdemanielle@gmail.com"}, {"n": "Alexander Binnie", "e": "alexanderbinnie@gmail.com"}, {"n": "Jason van Tonder", "e": "jcvt@webmail.co.za"}, {"n": "Kerstin Klein", "e": "kerstin.margit.klein@gmail.com"}, {"n": "Nkhensani Mahlaba", "e": "nkhensanimahlaba@gmail.com"}, {"n": "Jan Schiecke", "e": "janschiecke@gmail.com"}, {"n": "Dana Bruynesteyn", "e": "danabruynesteyn@gmail.com"}, {"n": "Svenja Hoss", "e": "svenja.hoss@gmx.de"}, {"n": "Melina Waschl", "e": "melina.waschl@gmx.de"}, {"n": "Rulisha Van Den Berg", "e": "rulisha@gmail.com"}, {"n": "Kelechi Akusobi", "e": "kelechiakusobi@gmail.com"}, {"n": "Tamara Sack", "e": "tamzsack@gmail.com"}, {"n": "Samia Tamir", "e": "samia.tamir@gmail.com"}, {"n": "Lloyd Kriel", "e": "lloydk1993@gmail.com"}, {"n": "Tom Moriceau", "e": "tomtomgo73@gmail.com"}, {"n": "Claire du Toit", "e": "clairendutoit@gmail.com"}, {"n": "Rumena Ivanova", "e": "rumena.iv@gmail.com"}, {"n": "Chloe Damon", "e": "david873lee@gmail.com"}, {"n": "Johan von Suchodoletz", "e": "jvonsuchodoletz@googlemail.com"}, {"n": "Victoria Worthington", "e": "vvcworthington@gmail.com"}, {"n": "Erin-Lee Petersen", "e": "researchunit710@gmail.com"}, {"n": "Jonasz Skrzypkowski", "e": "jonasz.skrzypkowski@gmail.com"}, {"n": "Christoph Kubica", "e": "kubicachristoph@gmail.com"}, {"n": "Jing Wang", "e": "njean3792@gmail.com"}, {"n": "Tamara Chetty", "e": "tamarachetty@icloud.com"}, {"n": "Daniel Collins", "e": "danielcollins575@gmail.com"}, {"n": "Joshua Friedman", "e": "josh.michael.friedman@gmail.com"}, {"n": "Shereen Banda", "e": "shereenbanda.sb@gmail.com"}, {"n": "Danielle Birkholz", "e": "daniellebirkholz3@gmail.com"}, {"n": "Kgaogelo Lefothla", "e": "lefothlakgaogelo@gmail.com"}, {"n": "Megan Campher", "e": "megancampher23@gmail.com"}, {"n": "Manuel Forster", "e": "manuelforster@gmx.de"}, {"n": "Anna Tembe", "e": "anna.tembe@gmail.com"}, {"n": "Milana Kolovrat", "e": "mkolovrat28@gmail.com"}, {"n": "Stefan Timm", "e": "stefan72superman@gmail.com"}, {"n": "Lexi Lukic", "e": "lexilukic@gmail.com"}, {"n": "Safanja Vermeule", "e": "safanjavermeule1999@gmail.com"}, {"n": "Karen Willenberg", "e": "willenberg.karen@gmail.com"}, {"n": "Darryn van der Walt", "e": "darryn.vanderwalt@gmail.com"}, {"n": "Charles Brain", "e": "charles.m.brain@gmail.com"}, {"n": "Charlotte Grillitsch", "e": "charlotte.grillitsch@gmail.com"}, {"n": "Michaela R.", "e": "pinkprinzess68@gmail.com"}, {"n": "Santiago Garzon", "e": "santiagogarzon04@gmail.com"}, {"n": "irina mladenova", "e": "incho133@gmail.com"}, {"n": "Alison Geduld", "e": "mrsalisongeduld@gmail.com"}, {"n": "Ben Steyn", "e": "bensteyn@hotmail.co.uk"}, {"n": "Lauren Naylor", "e": "laurenvnaylor@gmail.com"}, {"n": "Sonja Hariparsad", "e": "sonja.biancavalentine@gmail.com"}, {"n": "Kate Del Fante Scott", "e": "snoop.kdf@gmail.com"}, {"n": "Subash Sharma", "e": "mboksolutions@gmail.com"}, {"n": "Paula Raphael", "e": "paulajhr@gmail.com"}, {"n": "Bianca Voysey", "e": "voyseybianca@gmail.com"}, {"n": "Matthew Jarvis", "e": "8nbjr4hs9f@privaterelay.appleid.com"}, {"n": "Steph Naa", "e": "mortontitus369@gmail.com"}, {"n": "Dimpho-Dintle Moloi", "e": "dimpho.moloi.ddm@gmail.com"}, {"n": "Brian Gerrard", "e": "briangerrard11@gmail.com"}, {"n": "Bianca Waterberg", "e": "bianca@nspyre.co.za"}, {"n": "Kristin Trapanese", "e": "kristintrapanese@gmail.com"}, {"n": "Suzanna Marie", "e": "suzannamarie1@gmail.com"}, {"n": "Talya Galasko", "e": "tgalask92@gmail.com"}, {"n": "Heike Werth", "e": "heikewerth101@gmail.com"}, {"n": "Didier de Villiers", "e": "didierislands@gmail.com"}, {"n": "Taariq Mohamed", "e": "taariqmo@gmail.com"}, {"n": "Roswitha Becker", "e": "roswithabecker@ymail.com"}, {"n": "Menzi Nkosi", "e": "menzibu@gmail.com"}, {"n": "nikita swartz", "e": "nikitaleeswartz@gmail.com"}, {"n": "Shreya Naidoo", "e": "shreyanaidoo@gmail.com"}, {"n": "Isabel Rijk", "e": "isabel.rijk@hotmail.com"}, {"n": "Alison Geduld", "e": "mrandmrswebb@gmail.com"}, {"n": "Nicole King", "e": "nicoleking0504@gmail.com"}, {"n": "Merishka Harilall", "e": "merishkah@gmail.com"}, {"n": "Sisonke Papu", "e": "psisonke@gmail.com"}, {"n": "Fian Amar", "e": "ian@ubuntuwellness.com"}, {"n": "Annie Kok", "e": "anniekok3@gmail.com"}, {"n": "Louise Sweeney", "e": "louisesweeney248@gmail.com"}, {"n": "Dayna Pipe", "e": "daynacatherinepipe18@gmail.com"}, {"n": "Laura Wright", "e": "7bjnjjm8gd@privaterelay.appleid.com"}, {"n": "phumezwa Maneli", "e": "phumezwam@gmail.gov.za"}, {"n": "Debbie Biewis", "e": "debbiebiewis94@mail.com"}, {"n": "Alicia Butt", "e": "aliciabutt23@gmail.com"}, {"n": "Sima Smaile", "e": "simmbengo@gmail.com"}, {"n": "Pierethea sune Van Rocyen", "e": "peretheavanroen8@gmail.com"}, {"n": "Claire Hesam", "e": "clairehesam11@gmail.com"}, {"n": "Lundi Jansen van vuren", "e": "landijvv@gmail.com"}, {"n": "Ravi Bhookhun", "e": "ravibhookhun@gmail.com"}, {"n": "Kate Gibbs", "e": "kate.gibbs.1992@gmail.com"}, {"n": "Grant De Waal-Dubla", "e": "grant.dewaal@gmail.com"}, {"n": "Anold Klein", "e": "anold@agra.com.na"}, {"n": "Aneen Bergh", "e": "aneen6@hotmail.com"}, {"n": "josephine Broome", "e": "josephinebroome@hotmail.co.uk"}, {"n": "Freddie Leadsom", "e": "fleadsom1@gmail.com"}, {"n": "Dimitry Resnyansriy", "e": "9787137@gmail.com"}, {"n": "Carol Waer", "e": "skinconscious@gmail.com"}, {"n": "Claire O'Neill", "e": "claire.gsb@gmail.com"}, {"n": "Vashni Moousamy", "e": "vashnimoonsamy@yahoo.ca"}, {"n": "Cailin Daula", "e": "cailin.daula@gmail.com"}, {"n": "Janak Rama", "e": "jhrama@gmail.com"}, {"n": "Gaby Isabelle", "e": "gabyleaisabelle10@gmail.com"}, {"n": "Franklin victor Jacobs", "e": "fvjacobs@gmail.com"}, {"n": "Qhama Skenjana", "e": "qhama.skenjana02@gmail.com"}, {"n": "Karishma Rama", "e": "ramakashma@gmail.com"}, {"n": "Bharti Rama", "e": "gogirama77@gmail.com"}, {"n": "Samantha Grealy", "e": "gfvmcqphtj@privaterelay.appleid.com"}, {"n": "Megan Wylie", "e": "meganwylie.b@gmail.com"}, {"n": "Valery Moiseev", "e": "vamotest@gmail.com"}, {"n": "Amanda Barnard", "e": "barnara@stcyprians.co.za"}, {"n": "Jessie Ajces", "e": "jessajces@gmail.com"}, {"n": "Cesero Rodrignd", "e": "bluice247@gmail.com"}, {"n": "Leatitia Rowe Lochner", "e": "leatitialochner@gmail.com"}, {"n": "Nadia Scheffer", "e": "nadiascheffer@gmail.com"}, {"n": "Lina Saud", "e": "h.salano293@gmail.com"}, {"n": "Whitney Sangcham", "e": "gounravee@gmail.com"}, {"n": "Haneem Aaud", "e": "h.salamo293@gmail.com"}, {"n": "La'meez Rahim", "e": "lameezrahim@gmail.com"}, {"n": "PAMELLA NOMBILA", "e": "nongipamella@gmail.com"}, {"n": "Simamkele Simamkele", "e": "simsgqibs@gmail.com"}, {"n": "Danielle Richey", "e": "danielleguyette@yahoo.com"}, {"n": "Anelde Greeff", "e": "anelde.greeff@gmail.com"}, {"n": "Jesse Friedberg", "e": "jessej147@gmail.com"}, {"n": "Aurelie Bou", "e": "aureliebou09@gmail.com"}, {"n": "valerie koopman", "e": "valeriekoopman40@gmail.com"}, {"n": "Marriam Rassol", "e": "mariamrasool@ymail.com"}, {"n": "Dr Imraan Allie", "e": "imraanalie4@gmail.com"}, {"n": "Calla Woodrup", "e": "callasimonehilse@hotmail.com"}, {"n": "Azeez Abiaola", "e": "abiolaazeez@hotmail.com"}, {"n": "Meghan Dyck", "e": "meghdyck@gmail.com"}, {"n": "Zoe Fidler", "e": "z.f.fidler@gmail.com"}, {"n": "Anli Van Jaarrsveld", "e": "anlijaansveld@gmail.com"}, {"n": "Leisha Mostert", "e": "leishamostert@gmail.com"}, {"n": "Mathobela Mollo", "e": "mathobela@gmail.com"}, {"n": "Shannon walbruyh", "e": "shannon.walbruyho@gmail.com"}, {"n": "Jef Stevens", "e": "jef_stevens@hotmail.be"}, {"n": "Zeenat Paikaz", "e": "zeenat13seo@gmail.com"}, {"n": "Ashraf Parkar", "e": "ashuzee777@hotmail.com"}, {"n": "Jalisa Ismail", "e": "jalisaismail@gmail.com"}, {"n": "Rudo", "e": "rudomnisi@gmail.com"}, {"n": "steve rayner", "e": "stvrynr@gmail.com"}, {"n": "bronwyn Moonsamy", "e": "bronwynmoonsamy0606@gmail.com"}, {"n": "Micycle Addison", "e": "michaeladdison17@gmail.com"}, {"n": "Nat Chrzanowska", "e": "n.chrzanowska@gmail.com"}, {"n": "Rena Koufakis", "e": "rena_koufakis@yahoo.com.au"}, {"n": "Aviva Bruhin", "e": "aviva9296@hotmail.com"}, {"n": "으쌰 으쌰", "e": "hessed4316@gmail.com"}, {"n": "CHRISTO AUGUSTYN", "e": "christoaug9@gmail.com"}, {"n": "Andrea jennes", "e": "andrea.jennes1@gmail.com"}, {"n": "cathy kethro", "e": "cathy@freedonland.co.za"}, {"n": "Kiara Gabriel", "e": "kiaragabriel2000@gmail.com"}, {"n": "Keziah Dana Gabriel", "e": "keziahg.personal@gmail.com"}, {"n": "Smith Gareth", "e": "gvs0029@gmail.com"}, {"n": "Trevor Crawford", "e": "tjccrowd@hotunl.co.uk"}, {"n": "Stefanus Feris", "e": "stefanusferis77@gmail.com"}, {"n": "Cathy Dunlevy", "e": "cathydunlevy@hotmail.com"}, {"n": "Bridget Savage", "e": "bridgetolive@gmail.com"}, {"n": "Leah Alves", "e": "leahsavannah01@gmail.com"}, {"n": "Charlotte Grimmel", "e": "chgrimmel@gmail.com"}, {"n": "Liesbet Kristafor", "e": "liesbetkristafor@gmail.com"}, {"n": "Sabrina Rimola", "e": "nr29pnd2d6@privaterelay.appleid.com"}, {"n": "Mafika Qhawe", "e": "mafikaqhqwe@gmail.com"}, {"n": "Illiona Morris", "e": "capetownrent@gmail.com"}, {"n": "Matt Blaxk", "e": "matthewcam4@gmail.com"}, {"n": "Serge Warbout", "e": "sergewarbout@gmail.com"}, {"n": "Zandri Pienaar", "e": "pienaar.zandri@gmail.com"}, {"n": "Kimberly Van Vuuren", "e": "kimvv.design@gmail.com"}, {"n": "John Withington", "e": "johnwithington1@gmail.com"}, {"n": "Sonalia Hirday", "e": "sonaliahirday@gmail.com"}, {"n": "Liesel Coetzer", "e": "c9etzer10@gmail.com"}, {"n": "Sunniva Handeland", "e": "sunnihandeland@hotmail.com"}, {"n": "ANNA L.Hullan", "e": "annahallan@cdocd.com"}, {"n": "Nicole Huls", "e": "nicolehuls@hotmail.com"}, {"n": "Tailor Fahrenfort", "e": "t-fahrenfort@gmail.com"}, {"n": "Jullies Richard Abel", "e": "richardjullies@gmail.com"}, {"n": "Silindokuhle Mthembu", "e": "silindokuhlemtembu1@gmail.com"}, {"n": "Godfrey Mabongh", "e": "gmabong@mail.com"}, {"n": "Liesl Coetzer", "e": "coetzer10@gmail.com"}, {"n": "NINA ALBRECHT", "e": "albrecht.nina@gmail.com"}, {"n": "Michail Samouela Salamon", "e": "michail.a.s.salamon@gmail.com"}, {"n": "Ncumisa Sangotsha", "e": "ncumisamaphundu@gmail.com"}, {"n": "Jonathan McCarthy", "e": "jonomcc1999@gmail.com"}, {"n": "Ziyanda gidimisani", "e": "ziyanda448@gmail.com"}, {"n": "Siphokazi magoxo", "e": "sphokiem@yahoo.la"}, {"n": "Filipova Renie", "e": "filipovaren@gmail.com"}, {"n": "Kashiefa Salie", "e": "kashsalie@gmil.com"}, {"n": "Ryk Isabel", "e": "isabelryk@gmail.coim"}, {"n": "Megan Heying", "e": "mheymg5@gmail.com"}, {"n": "Dennis Van Burg", "e": "dvanberg@gmail.com"}, {"n": "Bhana Zaakir", "e": "mariamdb19@gmail.com"}, {"n": "Nurasrhe Ashen", "e": "ashen.nurashe@gmail.com"}, {"n": "Laura Hamunakwadi", "e": "laurankhoz@gmail.com"}, {"n": "Casper Hammers", "e": "casperhammer@hotmail.comcom"}, {"n": "Monica Marini", "e": "marinimonica@yahoo.ot"}, {"n": "Ellie Berman", "e": "management@strandkombuis.com"}, {"n": "Tanya Venter", "e": "misstanyaventer@gmail.com"}, {"n": "Chris Gouty", "e": "chrisgouty88@gmail.com"}, {"n": "Keiko Gouty", "e": "keikolkimball@gmail.com"}, {"n": "Melissa Goliath", "e": "melissaandjono@gmail.com"}, {"n": "Sophia Sikorski", "e": "sophia_sikorski@web.de"}, {"n": "Corina Toit", "e": "corinadutoit2@yahoo.com"}, {"n": "darrin smith", "e": "darrin@murciaco.com"}, {"n": "Lino Heiduck", "e": "heiduck@cxn.at"}, {"n": "Konstant Kohberger", "e": "leomonkanni@hotmail.com"}, {"n": "Lara Hatton", "e": "lara.hatton@gmail.com"}, {"n": "Narayan gayatri", "e": "gayatri.narayan@gmail.com"}, {"n": "Laila Mackay", "e": "mackaylaila@gmail.com"}, {"n": "Melanie Wence", "e": "mel.wence@gmail.com"}, {"n": "Candice Dumas", "e": "candicedumas@hotmail.com"}, {"n": "Nicole Roux", "e": "nroux@msn.com"}, {"n": "Alya Santos", "e": "aylasantos2401@gmail.com"}, {"n": "Kandarpa Sundari Devi Dasi", "e": "kashgoolab@gmail.com"}, {"n": "clementine mogodiri", "e": "clementinemogodiri@gmail.com"}, {"n": "Ashen N", "e": "ashen.nurasinha@gmail.com"}, {"n": "Rushanta Pillay", "e": "rushantapillay@gmail.com"}, {"n": "Isabel Vuuren", "e": "isabeljvvuuren@yahoo.com"}, {"n": "Ralph Lax", "e": "ralph.kelvin.lax@gmail.com"}, {"n": "Myrto.Chro@gmail.com Chroniari", "e": "myrto.chro@gmail.com"}, {"n": "Dirk Koekemoer", "e": "dircadirca@gmail.com"}, {"n": "Tania Beukes", "e": "twbeukes@gmail.com"}, {"n": "Sean Fletcher", "e": "amukelengubane@gmail.com"}, {"n": "Zavana Vincent", "e": "zavanavincent@gmail.com"}, {"n": "Lauren Sale", "e": "thepilatesfanatic@gmail.com"}, {"n": "Jacob", "e": "seatlholojacob@gmail.com"}, {"n": "Esmae", "e": "esmaehendricks.l@gmail.com"}, {"n": "Jelle Heijmering", "e": "jelleheijmering@hotmail.com"}, {"n": "Jeremy Chiyayap", "e": "jtchvayap@gmail.com"}, {"n": "Kathleen Huang", "e": "katt.huang17@gmail.com"}, {"n": "Gee Salie", "e": "gadijasal@gmail.com"}, {"n": "Gabrielle Olivier", "e": "oliviergabi@yahoo.com"}, {"n": "Rei Govinder", "e": "reigovinder@gmail.com"}, {"n": "Marlo Golding", "e": "marloigolding@gmail.com"}, {"n": "Megon Venter", "e": "megonventer@gmail.com"}, {"n": "Karen Arendt", "e": "1ekwine@gmail.com"}, {"n": "Mireille Wengr", "e": "rushka.brenner@gmail.com"}, {"n": "Naeema Page", "e": "naeemapage@gmail.com"}, {"n": "Charlene A", "e": "eleven11.charlene@gmail.com"}, {"n": "Leigh Helliwell", "e": "leighhelliwell@gmail.com"}, {"n": "Millicent Quoilin", "e": "quoilinmj@gmail.com"}, {"n": "Richard van Gysen", "e": "richardvangysen@gmail.com"}, {"n": "Jordan Scott-Turner", "e": "jordanscottturner@gmail.com"}, {"n": "Kirstin Wiedow", "e": "kirstin@globalinnovationgathering.org"}, {"n": "Nelisiwe Zangana", "e": "nelisiwezangana696@gmail.com"}, {"n": "Nahum Prince", "e": "nahumprince@gmail.com"}, {"n": "Erin Roemer", "e": "erinroemer8@gmail.com"}, {"n": "Sophia Reijnen", "e": "sophiareijnen@gmail.com"}, {"n": "Y Nowogrod", "e": "yaln2613@gmail.com"}, {"n": "Kathrin Will", "e": "kathrin-will@hotmail.de"}, {"n": "Charline Bois", "e": "boischarline@gmail.com"}, {"n": "Louken Poggenpoel", "e": "louken88@gmail.com"}, {"n": "Alistair Taylor", "e": "alistairgbtaylor@gmail.com"}, {"n": "Ying Zeijl stra", "e": "yingzeylstra@gmai.com"}, {"n": "Partner Ryan", "e": "utahryan101@gmail.com"}, {"n": "Nataneya Lala", "e": "nataneyalala@gmail.com"}, {"n": "María Andrade", "e": "mageme2@yahoo.com"}, {"n": "Shelagh Darcy Tlinos", "e": "shelaghdh@gmail.cin"}, {"n": "Lisa Crans", "e": "lisacrans@gmail.com"}, {"n": "Andrew Morris", "e": "andrewmamorris@gmail.com"}, {"n": "Beks", "e": "beksndlovu@gmail.com"}, {"n": "Tara Louw", "e": "tarastormlouw@gmail.com"}, {"n": "Katarina Kram", "e": "kram.katarina@gmail.com"}, {"n": "Dena Lomofsky", "e": "dena@za.southernhemisphere.co.za"}, {"n": "Shannon Jones", "e": "shanmaas@gmail.com"}, {"n": "Candice Padayachy", "e": "candicecherade@gmail.com"}, {"n": "Keith Snow", "e": "keithesnow@rogers.com"}, {"n": "Mandlakazi Gxagxa", "e": "mgxagxa07@gmail.com"}, {"n": "Igor B", "e": "igor.undying@gmail.com"}, {"n": "Gizelle De Nysschen", "e": "gizelle.denysschen@gmail.com"}, {"n": "Morgane Pintozzi", "e": "morganepintozzi@hotmail.fr"}, {"n": "Daniel Hewkey", "e": "danielhewkey86@yahoo.co.uk"}, {"n": "Elena Moretti", "e": "ele_martina@yahoo.it"}, {"n": "Hannah Mcinerny", "e": "hannah_mac1@hotmail.com"}, {"n": "pieter du toit smit", "e": "pdts12@gmail.com"}, {"n": "Shelley McKeaveney", "e": "shelley.mckeaveney@gmail.com"}, {"n": "Jonathan NADARJAH", "e": "nadarajah.jtn@gmail.com"}, {"n": "Valérie Waterschoot", "e": "valerie.waterschoot@gmail.com"}, {"n": "Melissa Mouton", "e": "melissamouton@icloud.com"}, {"n": "Annika Büser", "e": "geheim.fee0y@icloud.com"}, {"n": "Hanro Roos", "e": "hanroroos@gmail.com"}, {"n": "carly schwartz", "e": "carlyschwartz@gmail.com"}, {"n": "Simone Mackrill", "e": "simonemackrill@gmail.com"}, {"n": "Sofia Tavares", "e": "whynotniemand@gmail.com"}, {"n": "han may", "e": "hmaybery@gmail.com"}, {"n": "Joseph kaudinge", "e": "joseph.kaudinge7@gmail.com"}, {"n": "Maud Rosendahl", "e": "m.rosendahl99@gmail.com"}, {"n": "Sheralle Maclou", "e": "sherallemaclou@gmail.com"}, {"n": "Troels Graugaard", "e": "trohaagra@gmail.com"}, {"n": "Mishqa Rossier", "e": "mishqa.rossier@gmail.com"}, {"n": "Lisa Santosa", "e": "lisa.santosa@gmail.com"}, {"n": "Ida Perez", "e": "ahida.pg@gmail.com"}, {"n": "Mylène Dinalle", "e": "mylene.dinalle@gmail.com"}, {"n": "Romena", "e": "romenajulius@gmail.com"}, {"n": "Waseema Mahk", "e": "waseemamahk@gmail.com"}, {"n": "Michelle Steel", "e": "michksteel@gmail.com"}, {"n": "Dayne Deedat", "e": "dayne.deedat@gmail.com"}, {"n": "Natasha Van niekerk", "e": "natashaniekerk@gmail.com"}, {"n": "Casey Bryan", "e": "caseysbryan@gmail.com"}, {"n": "James Gervil", "e": "gervil@free.sr"}, {"n": "Cecile Bridgens", "e": "cecilebridgens1@gmail.com"}, {"n": "Nthabiseng Ramalope", "e": "ramalope@eskom.co.za"}, {"n": "Irene Mensinde", "e": "ireen65@live.nl"}, {"n": "Rene Newman", "e": "rene.newman@omwealth.co.za"}, {"n": "Louis", "e": "lourabe@mweb.co.za"}, {"n": "Catherine Phumzile Ngwenya", "e": "pngwenyamabila63@gmail.com"}, {"n": "Rowan Schindler", "e": "rowan.schindler@hotmail.com"}, {"n": "Phakamile Hlazo", "e": "macebisa@yahoo.com"}, {"n": "Marie-Louise Koen", "e": "marielouisekoen@gmail.com"}, {"n": "Daniel Goldstuck", "e": "daniel.goldstuck@gmail.com"}, {"n": "Ian Macfarlane", "e": "support@ubuntuwellness.com"}, {"n": "Filip Vik", "e": "filip_vik@hotmail.com"}, {"n": "Raquel Wijngaarde", "e": "raquel.wijngaarde@deptagency.com"}, {"n": "Fiona Sacks", "e": "fifi@iafrica.com"}, {"n": "Zainab Achmat", "e": "zainab@mzanzihealth.co.za"}, {"n": "Khanya Sibali", "e": "khanyasibali93@gmail.com"}, {"n": "Jonathan Fisher", "e": "jonfisher2305@gmail.com"}, {"n": "Hayley Shore", "e": "hayleyshore@gmail.com"}, {"n": "Jan Swart", "e": "jhswart@gmail.com"}, {"n": "Svetla Petkova", "e": "svetlapetkova23@gmail.com"}, {"n": "Lisa February", "e": "lisafeb92@gmail.com"}, {"n": "Victoria Guala", "e": "victoria.gaula@capetown.gov.za"}, {"n": "Louis Krige", "e": "louis@krige.com"}, {"n": "Pumeza Kewana", "e": "pume81@gmail.com"}, {"n": "Tracy Winde", "e": "winde@mweb.co.za"}, {"n": "Cindy Nell-Roberts", "e": "cindy@cosmetix.co.za"}, {"n": "Bronwyn Bonsma", "e": "babonsma@gmail.com"}, {"n": "Julia Bennett", "e": "juliacfb@hotmail.com"}, {"n": "Sjoerd Nikkelen", "e": "sjoerd.nikkelen@gmail.com"}, {"n": "Alexandra Hill", "e": "alexbluedoor@gmail.com"}, {"n": "Cloete Henry", "e": "hg@gmail.com"}, {"n": "Celumusa Kumalo", "e": "celumusa151@gmail.com"}, {"n": "Maz Nasr", "e": "maznasr1@gmail.com"}, {"n": "Anne Schady", "e": "anneschady@gmail.com"}, {"n": "Barbara Eckinger", "e": "barbara.eckinger@gmail.com"}, {"n": "Rogeema Kenny", "e": "rogeema.kenny@gmail.com"}, {"n": "Frankie Binneman", "e": "redplumfrank@yahoo.com"}, {"n": "Sinazo Randoyi", "e": "randoyisinazo@gmail.com"}, {"n": "Michael Zhoran", "e": "skabanga@mail.ru"}, {"n": "Camilla Refvik", "e": "camilla.refvik@gmail.com"}, {"n": "Julia Marsh", "e": "jmarsh23@hotmail.com"}, {"n": "Charlie Harrington", "e": "charlieharringtonstudio@gmail.com"}, {"n": "Tammy Godsall", "e": "tam_hy@hotmail.com"}, {"n": "Jenny Ricks", "e": "jennyricks@hotmail.com"}, {"n": "Melissa Kanters", "e": "melissakanters@gmail.com"}, {"n": "Raquel Thompson", "e": "raquel.v.thompson@gmail.com"}, {"n": "Klaus Mieske", "e": "dr.mieske@gmx.de"}, {"n": "Esther Ramsauer", "e": "bramsauer@bluewin.oh"}, {"n": "Ali Psiuk", "e": "ampsiuk@gmail.com"}, {"n": "Lisa Gnosa", "e": "l.gnosa@gmx.com"}, {"n": "Kat Stanners", "e": "katstanners@hotmail.co.uk"}, {"n": "Wesley Davis", "e": "wesafrica@gmail.com"}, {"n": "Wafa Ammar", "e": "good.6001@hotmail.com"}, {"n": "Mustafa Hazazi", "e": "hazazi_2007@hotmail.com"}, {"n": "Brandon Petersen", "e": "brendrp24210@gmail.com"}, {"n": "Yusrah Meyers", "e": "yusrah0603@gmail.com"}, {"n": "Mike Waters", "e": "mwaters@democratic-alliance.co.za"}, {"n": "Matt Schaal", "e": "matthias.schaal@gmail.com"}, {"n": "Margerie Bernhardt", "e": "mbernhardt78@yahoo.com"}, {"n": "Chantelle Sayag", "e": "noamsage@gmail.com"}, {"n": "Nhlanhla Ngidi", "e": "ngidinhlanhla@gmail.com"}, {"n": "Kevin Kelly", "e": "kkelly@evaluaid.co.za"}, {"n": "Dr Wendy Dicks", "e": "wendydicks.medical@gmail.com"}, {"n": "Stefan Vollmer", "e": "stefan.vollmer@pm.me"}, {"n": "Elroy Bartnig", "e": "elroybartnig@gmail.com"}, {"n": "Abdallah Osman", "e": "abdallahosman09@gmail.com"}, {"n": "Maryvonne Taristas", "e": "marietaristas.974@gmail.com"}, {"n": "Linda Brash", "e": "linda@brash.co.za"}, {"n": "Brianna Agogho", "e": "bmm1914@gmail.com"}, {"n": "Cas Van Hout", "e": "casvanhout@hotmail.com"}, {"n": "Peter Campbell", "e": "kampklok@gmail.com"}, {"n": "Rachel Nova", "e": "msrdav002@myuct.ac.za"}, {"n": "Satinder", "e": "satinderm@icloud.com"}, {"n": "Timothy Singh", "e": "timmylive@hotmail.co.za"}, {"n": "Liana Fernandes", "e": "lianafernandes@rocketmail.com"}, {"n": "Cati Vawda", "e": "cati.vawda@gmail.com"}, {"n": "Elin Ekvall", "e": "aebekvall@gmail.com"}, {"n": "Matt Beck", "e": "ryan@go2africa.com"}, {"n": "Carel Burger", "e": "carelburger@gmail.com"}, {"n": "Anisha Hira", "e": "hira.anisha@gmail.com"}, {"n": "Akilanga Tours", "e": "theodora@akilanga.co.za"}, {"n": "Yoshan Moodley", "e": "yoshan9@gmail.com"}, {"n": "Neiki Ullah", "e": "neiki.ullah@gmail.com"}, {"n": "Julia", "e": "juruff@gmx.de"}, {"n": "jana oosthuizen", "e": "jannaoosthuizen@gmail.com"}, {"n": "Ubuntu Wellness", "e": "lovewell@medispa.co.za"}, {"n": "Stanley Mgutshini", "e": "smgutshini@icloud.com"}, {"n": "Jacque Anena", "e": "jacqueanena@gmail.com"}, {"n": "Holly Hayes", "e": "kncv7rj727@privaterelay.appleid.com"}, {"n": "Craig Smith", "e": "craig@sourceevents.com"}, {"n": "Natasha Hamilton", "e": "nsharris80@gmail.com"}, {"n": "Brenda -Jane Scarborough", "e": "bscarborough@gmail.com"}, {"n": "Masizole Mnqasela", "e": "mnqasela@wcpp.gov.za"}, {"n": "Lyndon Benting", "e": "lmbenting@gmail.com"}, {"n": "Gomolemo Rehlampfo", "e": "gqteise@yahoo.com"}, {"n": "Charlotte Mostert", "e": "mostertcharlotte@gmail.com"}, {"n": "Megan Ackerman", "e": "megs.acker@gmail.com"}, {"n": "Lee-Anne Burrows", "e": "lee-anne.burrows@belmond.com"}, {"n": "Colleen Carstens", "e": "colleenc@rcsgroup.co.za"}, {"n": "Ian Macfarlane", "e": "ian@medispa.co.za"}, {"n": "Michael De Wet", "e": "michael@medispa.co.za"}]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function firstName(full: string): string {
  const w = (full || '').trim().split(/\s+/).filter(Boolean)
  return w[0] || 'there'
}

function letterFor(name: string, bookingUrl: string | null): string {
  const lines = [
    `Hi ${name},`,
    '',
    "It's been a while since your last visit, and honestly, the place has been too quiet without you.",
    '',
    'No guilt and no pressure — just an open invitation: 15% off your next booking, any day that suits you, for the rest of November.',
  ]
  if (bookingUrl) {
    lines.push(
      'The discount is already waiting when you book through this link:',
      '',
      `[Book your slot](${bookingUrl})`,
    )
  } else {
    lines.push(
      'Reply to this email with the day that suits you and we will hold your slot for you.',
    )
  }
  lines.push(
    '',
    "If the timing's not right, no hard feelings — reply to this email and we'll keep you posted for next time.",
    '',
    'See you soon,',
    'Ian',
  )
  return lines.join('\n')
}

function deny(): NextResponse {
  // Unknown token = this route does not exist, same invisibility law as Task 186.
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

async function facts() {
  const user = await db.user.findUnique({
    where: { email: ACCOUNT_EMAIL },
    select: { id: true, email: true, name: true, businessName: true, accountStatus: true, createdAt: true },
  })
  const [plan, wallet, links, states, marker] = await Promise.all([
    user ? planState(user.id) : Promise.resolve({ paid: false, plan: 'FREE' }),
    user ? db.wallet.findUnique({ where: { userId: user.id } }) : Promise.resolve(null),
    user ? db.bookingLink.findMany({ where: { userId: user.id }, select: { slug: true, title: true, active: true, bookings: true } }) : Promise.resolve([]),
    db.platformConfig.findMany({ where: { key: { startsWith: 'campaign_state:u-ubuntu' } } }),
    getConfig(MARKER_KEY),
  ])
  const emails = RECIPIENTS.map((r) => r.e)
  const [suppressed, existingRows, existingLeads, sentWindow] = await Promise.all([
    db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true, reason: true } }),
    user ? db.emailLog.findMany({ where: { userId: user.id, campaign: TAG, toEmail: { in: emails }, status: { in: ['QUEUED', 'SENT'] } }, select: { toEmail: true, status: true } }) : Promise.resolve([]),
    user ? db.lead.findMany({ where: { userId: user.id, email: { in: emails } }, select: { email: true } }) : Promise.resolve([]),
    user ? db.emailLog.count({ where: { userId: user.id, status: 'SENT', createdAt: { gte: new Date(Date.now() - SEND_BUNDLE_WINDOW_DAYS * 24 * 60 * 60 * 1000) } } }) : Promise.resolve(0),
  ])
  const bundle = plan.paid ? (PLAN_SEND_BUNDLES[plan.plan] ?? DEFAULT_SEND_BUNDLE) : 0
  const queueable = RECIPIENTS.filter((r) => EMAIL_RE.test(r.e)).length
  const airtimeSends = Math.max(0, queueable - Math.max(0, bundle - sentWindow))
  return {
    door: 'ubuntu-wave1-cue dry run — nothing was written',
    markerSet: Boolean(marker),
    account: user,
    plan,
    subscription: user ? await db.subscription.findUnique({ where: { userId: user.id } }) : null,
    walletBalanceRands: wallet ? wallet.balance / 100 : 0,
    recentLedger: user ? await db.creditTx.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 }) : [],
    bookingLinks: links,
    ubuntuCampaignStates: states,
    recipientsInFile: RECIPIENTS.length,
    validEmails: queueable,
    onSuppression: suppressed,
    alreadyQueuedOrSent: existingRows.length,
    leadsAlreadyOnAccount: existingLeads.length,
    wouldImportLeads: Math.max(0, queueable - existingLeads.length),
    wouldQueue: Math.max(0, queueable - suppressed.length - existingRows.length),
    airtime: { bundle, sentLast30d: sentWindow, airtimeSends, airtimeRands: (airtimeSends * SPEND_ACTIONS.EMAIL_SEND.cents) / 100 },
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (token !== READ_TOKEN) return deny()
  try {
    return NextResponse.json(await facts())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'read failed' }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (token !== WRITE_TOKEN) return deny()
  const marker = await getConfig(MARKER_KEY)
  if (marker) {
    return NextResponse.json({ error: 'One-shot law: this door already ran.', run: marker }, { status: 409 })
  }

  const user = await db.user.findUnique({ where: { email: ACCOUNT_EMAIL }, select: { id: true, email: true, businessName: true } })
  if (!user) {
    return NextResponse.json({ error: `No account under ${ACCOUNT_EMAIL} — nothing was done. Create the account first, then re-run.` }, { status: 404 })
  }
  const report: Record<string, unknown> = { campaign: TAG }

  // 1. Sender identity: the account speaks as Ubuntu Wellness.
  if ((user.businessName || '').trim() !== BUSINESS_NAME) {
    await db.user.update({ where: { id: user.id }, data: { businessName: BUSINESS_NAME } })
    report.businessName = `set to "${BUSINESS_NAME}" (was "${user.businessName || 'empty'}")`
  } else {
    report.businessName = 'already Ubuntu Wellness'
  }

  // 2. The paying law: Start campaign is a paying-user control.
  const before = await planState(user.id)
  if (!before.paid) {
    const now = new Date()
    const renews = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    await db.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id, plan: 'HUSTLER', status: 'ACTIVE', billingCycle: 'MONTHLY',
        amountCents: 19_900, provider: 'MANUAL', reference: 'HPSUB-UBUNTU-20261111',
        startedAt: now, renewsAt: renews,
      },
      update: { plan: 'HUSTLER', status: 'ACTIVE', provider: 'MANUAL', renewsAt: renews, pausedUntil: null },
    })
    report.subscription = 'Operator (HUSTLER) set ACTIVE, renews in 30 days'
  } else {
    report.subscription = `already paying (${before.plan}), untouched`
  }

  // 3. The load, at the platform's own ladder law (one TOPUP row, bonus inside).
  const wallet = await ensureWallet(user.id)
  const beforeRands = wallet.balance / 100
  const creditCents = Math.round(LOAD_CENTS * (1 + GROWTH_BONUS_PCT / 100)) // 165000 = R1,650
  await addCredits(user.id, creditCents, 'TOPUP', `Custom load R1,500.00 + ${GROWTH_BONUS_PCT}% Growth tier bonus (manual load by owner)`)
  const after = await db.wallet.findUnique({ where: { userId: user.id } })
  report.load = { loadedRands: LOAD_CENTS / 100, bonusRands: (creditCents - LOAD_CENTS) / 100, landedRands: creditCents / 100, balanceBefore: beforeRands, balanceAfter: (after?.balance ?? 0) / 100 }

  // 4. The client book: Fresha clients become unlocked Leads on this account.
  const emails = [...new Set(RECIPIENTS.map((r) => r.e).filter((e) => EMAIL_RE.test(e)))]
  const suppressedRows = await db.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } })
  const suppressedSet = new Set(suppressedRows.map((r) => r.email))
  const existingLeads = await db.lead.findMany({ where: { userId: user.id, email: { in: emails } }, select: { id: true, email: true, contactName: true } })
  const leadByEmail = new Map<string, string>()
  for (const l of existingLeads) if (l.email) leadByEmail.set(l.email.toLowerCase(), l.id)
  const freshLeads = emails.filter((e) => !leadByEmail.has(e))
  if (freshLeads.length > 0) {
    const byEmail = new Map(RECIPIENTS.map((r) => [r.e, r.n]))
    await db.lead.createMany({
      data: freshLeads.map((e) => {
        const full = byEmail.get(e) || ''
        return {
          userId: user.id,
          company: full || e,
          contactName: firstName(full),
          email: e,
          source: 'CSV',
          stage: 'NEW',
          unlocked: true,
          notes: 'Fresha client list · Nov 2026 · Ubuntu Wellness',
        }
      }),
    })
    const created = await db.lead.findMany({ where: { userId: user.id, email: { in: freshLeads } }, select: { id: true, email: true } })
    for (const l of created) if (l.email) leadByEmail.set(l.email.toLowerCase(), l.id)
  }
  report.leads = { imported: freshLeads.length, alreadyOnAccount: emails.length - freshLeads.length }

  // 5. The queue, born PAUSED. Suppression and duplicate laws honoured.
  // Booking link law: ONLY the canonical ubuntu-wellness page may ride the
  // letter. The account's other links (a "Virtual meeting l" test row) never
  // go out to 522 clients. No canonical page yet -> the letter offers the
  // reply-to-book path; one Edit draft later, the link line re-skins every
  // still-queued row when the page exists.
  const alreadyRows = await db.emailLog.findMany({ where: { userId: user.id, campaign: TAG, toEmail: { in: emails }, status: { in: ['QUEUED', 'SENT'] } }, select: { toEmail: true } })
  const alreadySet = new Set(alreadyRows.map((r) => r.toEmail))
  const canonical = await db.bookingLink.findUnique({ where: { slug: 'ubuntu-wellness' }, select: { slug: true, active: true, userId: true } })
  const bookingUrl = canonical && canonical.active && canonical.userId === user.id
    ? `https://www.hustleportal.online/book/${canonical.slug}`
    : null
  report.bookingLink = bookingUrl

  const toQueue = emails.filter((e) => !suppressedSet.has(e) && !alreadySet.has(e))
  if (toQueue.length > 0) {
    const byEmail = new Map(RECIPIENTS.map((r) => [r.e, r.n]))
    await db.emailLog.createMany({
      data: toQueue.map((e) => ({
        userId: user.id,
        toEmail: e,
        subject: SUBJECT.slice(0, 180),
        body: letterFor(firstName(byEmail.get(e) || ''), bookingUrl).slice(0, 4000),
        status: 'QUEUED',
        provider: 'PLATFORM',
        campaign: TAG,
        leadId: leadByEmail.get(e) || null,
      })),
    })
  }
  report.queue = { queued: toQueue.length, suppressedRefused: [...suppressedSet].filter((e) => emails.includes(e)).length, alreadyInQueue: alreadySet.size }

  // The state, written by the same lib the app's own build path uses.
  const sender = identityFromLabel(BUSINESS_NAME)
  const state: CampaignState = {
    status: 'PAUSED',
    perHour: PER_HOUR,
    from: sender.from,
    provider: isSesConfigured() ? 'SES' : 'RESEND',
    theme: 'goldrush',
    brand: sanitizeBrand({ name: BUSINESS_NAME }),
    ownerUserId: user.id,
    replyTo: ACCOUNT_EMAIL,
    createdAt: new Date().toISOString(),
  }
  await writeCampaignState(TAG, state)
  report.sender = { from: state.from, replyTo: state.replyTo, provider: state.provider, theme: state.theme, brand: state.brand, perHour: state.perHour, status: state.status }

  // Airtime math for the record (the debit law lives in tickCampaigns).
  const plan = await planState(user.id)
  const bundle = plan.paid ? (PLAN_SEND_BUNDLES[plan.plan] ?? DEFAULT_SEND_BUNDLE) : 0
  const used = await db.emailLog.count({ where: { userId: user.id, status: 'SENT', createdAt: { gte: new Date(Date.now() - SEND_BUNDLE_WINDOW_DAYS * 24 * 60 * 60 * 1000) } } })
  const airtimeSends = Math.max(0, toQueue.length - Math.max(0, bundle - used))
  report.airtime = { bundle, sentLast30d: used, airtimeSends, airtimeRands: (airtimeSends * SPEND_ACTIONS.EMAIL_SEND.cents) / 100, note: 'Debit lands only after each send actually goes out; drained wallet never blocks a send.' }

  const first = toQueue[0] ? { to: toQueue[0], subject: SUBJECT, body: letterFor(firstName((new Map(RECIPIENTS.map((r) => [r.e, r.n]))).get(toQueue[0]) || ''), bookingUrl) } : null
  report.sampleRow = first

  await setConfig(MARKER_KEY, JSON.stringify({ ranAt: new Date().toISOString(), campaign: TAG, queued: toQueue.length, loadRands: LOAD_CENTS / 100 }))
  report.locked = MARKER_KEY
  return NextResponse.json({ ok: true, ...report })
}
