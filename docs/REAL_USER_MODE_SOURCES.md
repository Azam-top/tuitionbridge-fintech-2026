# Real-user mode: which official sources and APIs exist (research only)

Checked 2026-10-18. Nothing was implemented, no account was created, no credential was used, and no request was sent to any provider's transactional API. Legend: **[V]** read or fetched by me today · **[S]** from a search result, not opened by me · **[?]** unknown.

## Source matrix

| Need | Official source found | Access | Status | What the app may claim |
|---|---|---|---|---|
| Reference USD→KZT rate | National Bank of Kazakhstan, `https://nationalbank.kz/rss/rates_all.xml` and per-date `https://nationalbank.kz/rss/get_rates.cfm?fdate=DD.MM.YYYY` | Public, no key | **[V]** both return HTTP 200 XML. USD = 452.12 for 18.10.2026 and 440.86 for 01.10.2026. A community library says the bank offers no formal API, only this feed. NBK metadata says rates are set daily and published the next day **[S]** | "NBK official reference rate, effective <date>, retrieved <time>". Never a transfer offer, fee or ETA |
| Executable rate, fee, delivery time | Wise Platform: `POST /quotes` "Create a quote (unauthenticated)" and `GET /rates` | Docs say affiliate partners can use them; `/rates` takes a Bearer token (a personal API token from a Wise account); the docs say the unauthenticated quote can omit the Authorization header | **[V]** docs read. Unsupported routes return `error.route.not.supported`. Sandbox "does not support all currency routes"; stable sandbox currencies are GBP, USD, EUR. KZT is not mentioned on any page I read. **USD→KZT route support is unknown** | Only if a real call succeeds for this payment: "Wise quote, <time>, reference-only until a transfer is created". Otherwise unknown |
| Provider price comparison | Wise Comparison API | All requests need authentication | **[V]** the docs say data are estimates built from third-party website data, refreshed about hourly, bank-transfer only, "for informational purposes and must not be used for critical flows" | Never a basis for a ranking or approval |
| Flywire quotes/fees | `developers.flywire.com`, `agents-api-docs.flywire.com` | Agents API is for agencies that intermediate payments for their clients | **[V]** landing and Agents API docs read. No payer-facing quote endpoint is described. The payer path is the university's own Flywire page | Nothing; do not imply an integration |
| Convera, other transfer services | none found | likely partner-only | **[?]** a search found no public Convera API documentation | Nothing |
| University payment instructions | the university's own finance page or PDF (for example KIMEP's PDF asks for a correspondent bank chosen by currency, payer name and IIN, payee IIN, student ID) | Public web page or document | **[S]** one example; no API; details differ per university and change | A beneficiary is "verified" only against a named page captured with its URL and date. An invoice can never create or edit a trusted beneficiary |
| User's USD balance and reserve | no official source usable here | the user | **[?]** no bank connectivity exists in the project | "Self-reported" |
| Real model | Claude API. Current IDs `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; all current models support tool use | the user's own key and budget | **[V]** models page. Supported-regions page lists Kazakhstan and not mainland China; its stated effective date is 12 Nov 2026 and it covers use by people physically in an unsupported region **[V]** | Mode shows LIVE only after a verified run |

## What stays unknown (must display as unknown, never as a demo number)
USD→KZT executable fee and arrival time from any provider; whether Wise supports this exact route and funding method for this payer; the university's accepted payment channels and cutoffs unless the user supplies the official page; the user's real balance; provider-side settlement status.

## Proposed shape of the real-user mode (for your decision, not built)
1. **Invoice**: user uploads a real text PDF or pastes text; fields are reviewed and confirmed (existing flow). No OCR. In LIVE mode the invoice text goes to the model provider, so use only what you accept sharing.
2. **Beneficiary**: user adds the university's official payment-details URL; the app stores the capture date and a hash, shows what was matched, and still refuses documents that disagree with it.
3. **Rates and terms**: show the NBK reference rate with source and date. Show an executable quote only if a real provider call succeeds; otherwise "No executable quote available" and an "Open the university's payment page" handoff. No fixture providers in this mode.
4. **Execution**: disabled (planning only) until a real provider integration with credentials and confirmed route support exists. The sandbox ledger stays labeled SIMULATED and separate from real-user mode.
5. **Model**: real answers through the existing `LlmClient` boundary, with the existing guards; usage recorded; failures reported.

## Decisions needed from you
1. May I make **one read-only unauthenticated Wise quote request** (USD→KZT, a sample amount, no account, no personal data) to learn whether the route exists? It contacts a third party's production API and is subject to their terms, so I have not done it. Or supply a Wise token yourself.
2. Your own LLM key and a spending limit for a real model run (see `docs/LIVE_RUN.md`).
3. Which real invoice and university page will be used, and are you comfortable with the invoice text reaching the model provider?
4. Scope: planning-only real mode (recommended for the deadline) versus real execution later.
