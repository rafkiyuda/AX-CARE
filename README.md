# AX CARE – prototype

Clickable on-premise-style web app from the *AX CARE – Prototype PRD* (BBCG, 5 Nov 2026). Everything runs on **simulated sample data** in the browser: 6 welding stations, one weld every 2 s each, signals every 1 s, 50,000 welds of history.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Production: `npm run build && npm start`, or deploy the folder to Vercel.

**Gemini (optional).** Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. The key is only read by the server route `src/app/api/ai/route.ts`. Without a key every AI feature uses template answers built from the rules and statistics, and Settings shows "AI offline – using templates". Model IDs come from `GEMINI_PRO_MODEL` / `GEMINI_FLASH_MODEL`; check them on the day of the demo.

## 3–4 minute demo script

1. **Overview** (Ji-ho, production manager): KPIs, 6 station cards, uptime / welds-per-hour / yield charts.
2. **▶ Scenario → S1 Window contamination**: open WELD-03. PGM rises 2 %/h (time-lapse); the spare window is auto-ordered at 80 % used, a warning fires at 70 % with "Window life left: about 6–7 h", then critical at 85 %. Alerts → open the alert → *Explain this alert* → *Create work order* → Service & parts → *Complete and close*. The alert is resolved and written to the value ledger.
3. **S2 Power drift**: WELD-05 loses 0.6 %/day over 5 days in 30 s. The anomaly score passes 60 (driven by laser power) and an AXBIS remote check is booked within the CARE+ 4 h response time.
4. **Switch tier to QUALITY+ → Quality**: search `MOD-2611-0482`; all 36 welds with depth, gap, plasma, score and verdict. Export CSV / JSON or print the PDF certificate. Run **S3 Depth drop** to see CHECK/NG welds on two held modules and the re-inspection queue.
5. **✦ Copilot**: "Why did WELD-05 drift?", "Write the shift report". Each answer has an *AI-generated* label, *Show data used*, and greys out any number that is not in the data sent to the model.
6. **Value report** (Hye-rin, buyer): downtime and scrap avoided vs the contract fee. Hover any number to see its formula. The assumptions are editable.

**S0 Normal** resets the whole demo. The tier switcher in the top bar locks and unlocks screens (RETROFIT → CARE → CARE+ → QUALITY+).

## Where things are

| Area | File |
|---|---|
| Simulation engine: signals, welds, scoring, rules, anomaly score, remaining life, scenarios, actions | `src/lib/sim.ts` |
| Thresholds, stations, tiers, roles | `src/lib/config.ts` |
| AI context snapshot, templates, number checking, client calls (12 s timeout, 10/min, cache) | `src/lib/ai.ts` |
| Gemini proxy (REST `generateContent`, structured JSON output) | `src/app/api/ai/route.ts` |
| Screens | `src/app/*/page.tsx` |
| Shell: top bar, tier switcher, scenario player, copilot drawer | `src/components/` |

## PRD coverage

All 12 P0 features (F01–F12) are built. From P1, F13 shift report, F14 alert explainer, F15 work orders and calendar, F16 value report, F17 MES export with an OPC UA / REST settings mock, and F18 EN/KO labels (nav and main labels only) are also in. Not built: F19 AXBIS service console and F20 weld-photo check (both P2).

Thresholds are prototype values, not AXBIS or customer limits. Prices are placeholders.
