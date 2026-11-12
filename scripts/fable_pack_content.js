// Content for the HustlePortal Client Video Prompt Pack (8 paste-ready Fable prompts).
// Each prompt is fully self-contained: style block + scenes + VO script + brand rules.
// Grounded in real app labels: New appointment, Email invite, Add notes / Notes ✓,
// Begin campaign, Edit draft, {first_name}, Find leads with AI, New/Contacted/Proposal/Won.

const STYLE = `VISUAL STYLE (match exactly):
- Background: deep charcoal (#111216) with a soft warm yellow glow behind the action.
- Headlines: bold condensed uppercase, white, maximum 6 words, with exactly one line or word highlighted yellow (#F5C518) per scene.
- UI mock cards: dark grey (#1B1D23) rounded rectangles, thin subtle borders, realistic micro-copy, yellow primary buttons, green success states, red reserved only for pain in the hook.
- No real screen recordings: every UI element is a stylized mock card, readable even at 50% zoom.
- Pace: 3 to 6 seconds per scene, one action per scene, gentle zoom toward the button being pressed. 9:16 vertical throughout.`;

const BRAND = `BRANDING:
- The Business Hustle logo (yellow rounded square with BH) small and static in the top-left corner from scene 2 onward.
- End card: logo centered, "hustleportal.online" underneath, a yellow pill button labelled LOG IN, on the charcoal background.
- Footer credit line on the end card only: "HustlePortal - the whole business in one place".
- No other logos, no watermarks, no stock footage, no people on camera.`;

const RULES = `RULES:
- One fictional example runs through the whole video; keep names, amounts and details consistent from scene to scene.
- Every screen must look like HustlePortal: charcoal cards, yellow actions, plain English labels.
- The video teaches, so every click gets its own beat and the result of the click is always shown.
- Sentences spoken and sentences shown must say the same thing in different words.`;

const prompts = [
  {
    title: 'Set up a meeting (Calendar)',
    teaches: 'Book an appointment, send the invite with the meeting link, take minutes during the call.',
    example: 'Lerato, a physiotherapist in Durbanville, booking a consult with a new client (Thandi K.).',
    swap: 'Swap the trade and client name for any client. If they run group sessions, change the title to "Group session".',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to book a client meeting in HustlePortal. It is training, not an ad: every step must feel followable, like a colleague showing their screen. The example user is Lerato, a physiotherapist in Durbanville.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "STILL BOOKING IN YOUR HEAD?" Mock: a paper diary with scribbles, a chat bubble reading "can we move to Thursday?", a red badge stacking up. VO hook line.
2. REVEAL (4-8s). Headline: "ONE CALENDAR. EVERY MEETING." Mock: the HustlePortal sidebar (Dashboard, Leads & CRM, Clients, Tasks, Calendar, Invoices, Finance, Mail) with "Calendar" highlighted yellow. 
3. CREATE (8-15s). Mock: the Calendar screen with an "Upcoming" list, then a yellow button "New appointment" pressed, and a dialog filling in: title "Consultation: Thandi K.", date "Tue 18 Nov, 10:00". Show one tap per field.
4. THE INVITE (15-23s). Headline: "THEIR INVITE SENDS ITSELF." Mock: the client email field being typed "thandi@example.co.za", save pressed, a green toast "Invite sent", then an email card opening: "You're booked - your meeting link is inside". 
5. MINUTES (23-31s). Headline: "TAKE NOTES ON THE CALL." Mock: the appointment row carrying a small chip "Add notes"; a tap opens a "Notes & minutes" card where this line types itself: "Quoted 6 sessions. Starts Monday." The chip flips to a green "Notes" chip. 
6. CTA (31-38s). Headline: "BOOK YOUR NEXT ONE IN HUSTLEPORTAL." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 105 words): "Still booking clients in your head and hoping you remember? Here is how you book a meeting in HustlePortal. Open Calendar and press New appointment. Give it a title, pick your date and time. Now add their email address and save. The invite lands in their inbox straight away, with your meeting link inside. During the call, tap Add notes and type what you agree. Quoted six sessions, starts Monday. It stays on the appointment, so next time you know exactly where you left off. Your diary, your invites and your notes, all in one place. Book your next one in HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Client outreach (Mail > Begin campaign)',
    teaches: 'Batch-email your own contacts with Begin campaign, the {first_name} greeting, the born-paused Start gate, read receipts.',
    example: 'Nadia, a hair salon owner in Claremont, filling her quiet Tuesday slots.',
    swap: 'Swap the offer and trade (a spa selling a November special, a plumber offering a winter check). Keep the Start-gate beat - it is the trust moment.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to email her own clients from HustlePortal with Begin campaign. It is training, not an ad. The example user is Nadia, a hair salon owner in Claremont with a quiet Tuesday.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "YOUR CLIENTS FORGOT YOU EXIST." Mock: an empty Tuesday column in a calendar, three greyed "unfilled slot" cards, a sad bell icon. 
2. REVEAL (4-8s). Headline: "EMAIL THEM ALL. IN ONE GO." Mock: the HustlePortal sidebar with "Mail" highlighted yellow; a campaign card with a yellow "Begin campaign" button.
3. PICK (8-15s). Mock: the audience step - a contact list with checkboxes ticking down: "128 contacts selected", a filter chip "past clients". 
4. WRITE (15-24s). Headline: "EVERY EMAIL SAYS THEIR NAME." Mock: a compose card typing: subject "15% off, this Tuesday only" and body starting "Hi {first_name}," with a hint line "filled per person before it sends". Preview cards show "Hi Thabo," "Hi Michelle," "Hi Karen,".
5. THE GATE (24-31s). Headline: "NOTHING SENDS UNTIL YOU SAY GO." Mock: the campaign card sitting in a paused state with a yellow "Start" button and a line "45 per hour, paced like a human"; a press on Start turns the row green "Sending"; then a read-receipt panel: "Opened - 61".
6. CTA (31-38s). Headline: "FILL YOUR QUIET DAYS." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 110 words): "Your clients did not leave. They just forgot. Open Mail and press Begin campaign. Pick your contacts - one hundred and twenty-eight past clients, ticked in one tap. Write the letter once: fifteen percent off, this Tuesday only. Start it with Hi, and type first name in curly brackets - HustlePortal fills every email with the person's own name before it sends. And here is the part you will love: nothing sends until you press Start. Your campaign waits for you, then goes out paced like a human, with your business name on every message. Then watch the receipts come in. Sixty-one opened. Fill your quiet days with HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Perform a proper lead search (Leads & CRM)',
    teaches: 'Use Find leads with AI: describe the ideal customer specifically, read the reason on each result, add only the real fits.',
    example: 'Sipho, a plumber in Pretoria east, looking for businesses that need a maintenance contract.',
    swap: 'Swap the search for the client trade. Teach the specificity rule every time: trade + area + the need.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to run a proper lead search in HustlePortal. It is training, not an ad. The example user is Sipho, a plumber in Pretoria east who wants maintenance contracts, not one-off jobs.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "WHERE DO NEW CLIENTS COME FROM?" Mock: a blank pipeline board, a cursor blinking in an empty search box. 
2. REVEAL (4-8s). Headline: "ASK. AND THE SCOUT FINDS." Mock: the HustlePortal sidebar with "Leads & CRM" highlighted yellow; a card titled "AI scout - real businesses from the live web".
3. THE BAD ASK (8-12s). Mock: the search box typed "plumbers" and a result list that is all over the place, crossed out with a soft red X. Headline: "TOO VAGUE. JUNK COMES BACK."
4. THE GOOD ASK (12-20s). Headline: "TRADE. AREA. THE NEED." Mock: the search box retyped: "Property managers in Pretoria east with 10+ buildings who outsource maintenance"; a yellow "Find leads" button pressed; a progress shimmer.
5. RESULTS (20-29s). Mock: result cards sliding in, each with a name, an area and a yellow reason line: "No maintenance partner listed", "3 building portfolio", "Website asks for contractors". A tap on "+ Add" turns one card green "Added to pipeline". Repeat twice.
6. CTA (29-38s). Headline: "STOP COLD GUESSING." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 115 words): "Where do new clients come from? Ask the scout. Open Leads and press Find leads with AI. Now, the rule that makes it work: trade, area, the need. Just typing plumbers gives you junk. But property managers in Pretoria east, with ten or more buildings, who outsource maintenance - that is a real question. The scout comes back with actual businesses from the live web, and it tells you why each one fits: no maintenance partner listed, three buildings on the books, a website asking for contractors. You are not guessing anymore. When a result is real, press Add, and it drops straight into your pipeline. Stop cold guessing. Start asking HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Run your pipeline (new lead to won)',
    teaches: 'Drag leads through New, Contacted, Proposal, Won; the pipeline value counts up; Won turns green.',
    example: 'Marius, who runs a guest house in Stellenbosch, winning a corporate booking account.',
    swap: 'Swap the lead and amounts for the client trade. Keep the counting money beat - it is the emotional peak.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to move deals through the HustlePortal pipeline. It is training, not an ad. The example user is Marius, who runs a guest house in Stellenbosch and wants corporate booking accounts.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "LEADS DIE IN YOUR INBOX." Mock: twelve unread email rows, one highlighted "Re: conference booking?" sinking into a grey void. 
2. REVEAL (4-8s). Headline: "EVERY LEAD. ONE PIPELINE." Mock: four columns on charcoal cards: New, Contacted, Proposal, Won, with the counter "Pipeline R48 500" on top.
3. DRAG ONE (8-16s). Mock: a lead card "Cape Tech - corporate account R14 000" in New; a drag gesture moves it to Contacted, then to Proposal; the counter ticks up in green with each move.
4. THE WIN (16-24s). Headline: "DROP IT IN WON." Mock: the card dragged into Won; the whole Won column glows green; "Won this month" flips from R0 to R14 000 with a counting animation; a small green toast "Moved to Won".
5. THE HABIT (24-31s). Mock: three more cards following the same path in fast-forward; the counters climbing: R48 500 to R76 200, Won R14 000 to R41 500. 
6. CTA (31-38s). Headline: "SEE YOUR MONEY MOVE." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 105 words): "Leads die in your inbox. Here is where they go to live. Every lead in HustlePortal sits on one pipeline: New, Contacted, Proposal, Won. Cape Tech, fourteen thousand rand, sitting in New. You called - drag it to Contacted. You sent the proposal - drag it to Proposal. And when they say yes, drop it in Won, and watch your month light up green. Fourteen thousand, won. The counter on top is your pipeline value - every rand waiting on a decision, visible in one glance. Move every card every day, and the board becomes your business. See your money move, in HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Import your client list',
    teaches: 'Bring an existing client book into HustlePortal as leads with a CSV import, ready for a first campaign.',
    example: 'Colleen, who has run a float spa for nine years with 1,300 clients on an old system.',
    swap: 'Swap the system name ("my old booking system") and the count. Keep the honest line about old numbers - it protects trust.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to import an existing client list into HustlePortal. It is training, not an ad. The example user is Colleen, who has run a float spa for nine years and has 1,300 clients stuck in an old booking system.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "NINE YEARS OF CLIENTS. IN A DRAWER." Mock: a stack of old paper cards and a spreadsheet card labelled "clients_final_v7.xlsx" gathering virtual dust.
2. REVEAL (4-9s). Headline: "BRING THE BOOK WITH YOU." Mock: the HustlePortal sidebar with "Leads & CRM" highlighted yellow; a yellow "Import CSV" button.
3. UPLOAD (9-16s). Mock: a CSV file card dropped onto a drop zone; a progress bar; a checklist ticking itself: "names read, emails found, duplicates skipped".
4. THE BOOK, ALIVE (16-25s). Headline: "1,300 CLIENTS. ONE PLACE." Mock: the pipeline New column filling with rows scrolling: "Natalie W.", "Thabo M.", "Karen S.", each with a small "past client" tag; a counter climbing to 1,300.
5. FIRST WAVE (25-31s). Mock: a yellow "Begin campaign" button with the line "pick these contacts and say hello"; a paused campaign card waiting on Start. 
6. CTA (31-38s). Headline: "YOUR PAST PAYS AGAIN." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 105 words): "Nine years of clients, sitting in a drawer. Bring the book with you. In Leads, press Import CSV, drop your file in, and HustlePortal does the careful part: names read, emails found, duplicates skipped. Thirteen hundred clients, in one place, each one tagged as a past client. Your old numbers are not dead - they are just waiting. Pick them, say hello with your first campaign, and nothing sends until you press Start. Nine years of goodwill, working for you again. Your past pays again, in HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Invoice and get paid',
    teaches: 'Create and send an invoice, mark it paid, and see money in and out on the same screen in Finance.',
    example: 'Johan, a builder in Boksburg, invoicing a kitchen fit-out.',
    swap: 'Swap the trade and amounts. For clients who do monthly accounts, mention statements in the VO swap line.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to invoice from HustlePortal and see the money land in Finance. It is training, not an ad. The example user is Johan, a builder in Boksburg finishing a kitchen fit-out.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "THE JOB IS DONE. THE INVOICE ISN'T." Mock: a beautiful finished kitchen photo card next to a crumpled handwritten invoice card with red "30 days overdue" stamp.
2. REVEAL (4-9s). Headline: "BILL FROM THE SAME PLACE YOU WORK." Mock: the HustlePortal sidebar with "Invoices" highlighted yellow; a yellow "New invoice" button.
3. CREATE (9-17s). Mock: the invoice card filling in: client "Mrs. Botha - kitchen fit-out", three line items "Labour R8 500, Cabinets R21 400, Sink R2 100", total R32 000 types itself.
4. SEND (17-24s). Headline: "IN THEIR INBOX IN ONE TAP." Mock: a press on "Send"; a green toast "Invoice sent"; then the row flips to green "Paid" with the date stamped; a matching "Money in R32 000" row appears on a Finance card.
5. THE WHOLE PICTURE (24-31s). Mock: the Finance screen with Money in and Money out columns, a net figure highlighted yellow, small rows for materials leaving. 
6. CTA (31-38s). Headline: "DO THE WORK. GET PAID IN ONE PLACE." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 110 words): "The job is done. The invoice is not. Fix that. In HustlePortal, press New invoice. Mrs. Botha, kitchen fit-out: labour, cabinets, sink - thirty-two thousand rand, total types itself. One tap on Send and it is in her inbox, with your name on it. When the money lands, the row turns green: Paid. And look down - the same rands appear in Finance, money in, right next to money out. Your work, your invoices and your money, on one screen. No more invoice Sunday, no more guessing what you actually made. Do the work, get paid in one place - HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Your booking page (let clients book themselves)',
    teaches: 'Share the personal booking link; a client books a slot; it appears in the Calendar and the invite email goes out.',
    example: 'Aisha, a beauty studio owner in Rondebosch, putting the link in her Instagram bio.',
    swap: 'Swap the trade and the slot types (consultation, follow-up, house call). For trades without a walk-in trade, the Instagram-bio beat becomes a WhatsApp status beat.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that teaches a small business owner how to let clients book themselves with a HustlePortal booking page. It is training, not an ad. The example user is Aisha, a beauty studio owner in Rondebosch who is tired of WhatsApp ping-pong.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "SIX MESSAGES TO BOOK ONE SLOT." Mock: a chaotic WhatsApp thread stacking bubbles: "Tuesday full", "Wednesday maybe", "what about 3?", a red badge hitting 6.
2. REVEAL (4-9s). Headline: "SEND ONE LINK INSTEAD." Mock: the HustlePortal sidebar; a "Booking page" card with a yellow "Share" button and a clean link "hustleportal.online/b/aisha".
3. THE CLIENT SIDE (9-18s). Headline: "THEY PICK. YOU GET BOOKED." Mock: a phone-frame card showing the client view: the studio name, service chips "Facial 45min, Lashes 60min", a clean slot grid, a tap on "Wed 10:00", a green "Booked" state.
4. YOUR SIDE (18-26s). Mock: the Calendar screen; the new appointment row slides into Upcoming: "Aisha - Facial, Wed 10:00" with a "Booked online" tag; a green toast "Invite sent"; an email card "Your appointment is confirmed - link inside".
5. THE LIFE (26-31s). Mock: three more bookings landing in fast-forward while Aisha's phone lies face-down; the day column filling up calmly.
6. CTA (31-38s). Headline: "PUT THE LINK IN YOUR BIO." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 110 words): "Six messages to book one slot? Send one link instead. Your HustlePortal booking page shows your services and your open times. They tap, they pick Wednesday at ten, done - booked. On your side it is already in your calendar, tagged booked online, and the confirmation lands in their inbox with your link inside. No double bookings, no Tuesday full messages, no what about three. Put the link in your bio, your status, your email signature - and let your clients book themselves. You just show up. One link, booked solid - HustlePortal."

${BRAND}

${RULES}`
  },
  {
    title: 'Your first five minutes (the tour)',
    teaches: 'The one video for every brand-new client: sign up, welcome credits, first lead search, first appointment, first invoice - the whole loop.',
    example: 'A brand-new user, "your business", no named persona - so every client sees themselves.',
    swap: 'Keep this one generic on purpose. If a client is stuck on one section, send the specific video instead.',
    text: `Create a 38-second vertical explainer video (1080x1920, 9:16 portrait) that gives a brand-new HustlePortal user their first five minutes: the whole loop, from sign-up to first invoice. It is training, not an ad. No named persona - the user is simply "your business", so every client sees themselves.

${STYLE}

SCENES (in this order):
1. HOOK (0-4s). Headline: "FIVE APPS. THREE SPREADSHEETS. ONE YOU." Mock: app icons stacking on top of a tired person-free desk scene made of cards; badges multiplying.
2. REVEAL (4-9s). Mock: the BH logo card; headline "YOUR WHOLE BUSINESS. ONE PORTAL."; the sidebar fans out: Dashboard, Leads & CRM, Clients, Tasks, Calendar, Invoices, Finance, Mail.
3. MINUTE ONE (9-15s). Headline: "TELL IT WHO YOU SELL TO." Mock: the AI scout card taking one line "mobile car washes in Centurion"; yellow "Find leads" pressed; three result cards with "+ Add".
4. MINUTE TWO (15-22s). Mock: the Calendar "New appointment" beat, the invite toast "Invite sent"; then a quick cut.
5. MINUTE THREE (22-29s). Mock: the invoice beat: "New invoice" filled, "Send" pressed, the row green "Paid", the Finance card ticking "Money in".
6. THE OFFER (29-34s). Mock: a yellow pill "Welcome credits cover your first leads" under the BH logo.
7. CTA (34-40s). Headline: "FIVE MINUTES. START TODAY." End card with logo, hustleportal.online, yellow LOG IN pill.

VOICEOVER (warm, second person, about 115 words): "Five apps, three spreadsheets, one of you. HustlePortal puts the whole business in one place, and your first five minutes look like this. Tell it who you sell to: mobile car washes in Centurion - the scout finds real ones, press Add. Book your first meeting: New appointment, their email in, invite sent, meeting link in their inbox. Send your first invoice: fill it, tap send, paid - and the money shows in Finance, next to everything going out. Your welcome credits cover your first leads, so you start free. Five minutes, one login, your whole business in one place. Start today at HustlePortal."

${BRAND}

${RULES}`
  },
];

const anatomy = {
  intro: [
    'Clients keep asking how to use the app. This pack turns the launch video into a teaching series: eight paste-ready prompts, one per topic, each producing a short vertical video in the same style as the launch ad. Paste one prompt into Claude with Fable, review the generated storyboard, publish.',
    'The app already carries a built-in Tutorial button on every screen, so a client who is lost inside the platform has text walkthroughs at thumb reach. These videos are the share-outside-the-app layer: WhatsApp status, Instagram, the client group, the onboarding email. One topic per video, thirty to forty seconds each.',
  ],
  anatomyTitle: 'What the launch video does (keep this DNA)',
  anatomy: [
    'Format: 36 seconds, vertical 1080x1920 (9:16), motion graphics built entirely from stylized mock-UI cards on a dark charcoal background with a warm yellow glow. It never shows a real screen recording, which is why it still looks premium while the real app evolves.',
    'Story arc: a pain hook (5 apps, 3 spreadsheets, 1 lead you forgot - then 10 logins), a brand reveal (your whole business, one portal), three or four feature beats that each show one action and its result, an offer line (welcome credits cover your first leads), and a CTA end card (try HustlePortal today, link in bio).',
    'The continuity trick: one fictional client story (dental practices in Sandton) runs through every scene - the scout finds Brightside Dental, the card moves through the pipeline, the AI co-founder plans the follow-up, the invoice goes to Lumen Dental. Same names, same amounts, start to finish. This is what makes it feel like one business instead of four features.',
    'Voiceover: conversational, second person, roughly 130 words in 36 seconds, speaking the same thing the screen shows in different words. The on-screen headlines are short (max six words) and carry one yellow accent word or line each.',
    'Discipline to keep in every new video: one action per scene, the result of every click always shown, money and success always green, pain only in the hook, and the last frame always the BH logo end card.',
  ],
  howTo: [
    'One prompt = one video. Each prompt below is self-contained: it carries the full visual style block, the scene-by-scene breakdown with exact on-screen text, the finished voiceover script, the branding rules and the consistency rules. No assembly needed - paste it whole.',
    'Generate one at a time. Read the storyboard Fable returns and check three things before you render: the mock labels match the real app (New appointment, Begin campaign, Find leads, {first_name}), the example business stays consistent across scenes, and the end card carries the right CTA for the channel (LOG IN for most; swap to a "link in bio" pill for Instagram or TikTok cuts).',
    'Localize per client in ten seconds: change the example business in the prompt (the swap line under each prompt tells you exactly which parts to change). Keep the structure - the hook, the gate moment, the green success state - because that is the DNA that made the original work.',
  ],
};

module.exports = { prompts, anatomy };
